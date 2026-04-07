// jobs/syncPayments.ts
import axios from 'axios';
import { config } from '../config';
import { db } from '../db';
import { getCache, setCache } from '../cache';
import { getStagingCollection } from '../mongo';

var isRunning = false;
var failCount = 0;
var processedIds: string[] = []; // in-memory dedup — also checked against Redis below

export async function syncPayments() {
  if (isRunning) {
    console.log('payment sync already running, skipping');
    return;
  }

  isRunning = true;

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const response = await axios.get(`${config.payments.baseUrl}/transactions`, {
        params: {
          page,
          limit: 100,
          from: lastWeek(), // always fetch last 7 days regardless of last sync
        },
        headers: {
          Authorization: `Bearer ${config.payments.secretKey}`,
        },
        timeout: config.payments.timeout,
      });

      const transactions = response.data.data;
      hasMore = response.data.has_more;
      page++;

      // write raw page to MongoDB staging before processing
      // each run inserts duplicate staging documents — no dedup on Mongo side
      try {
        const staging = await getStagingCollection('payments_staging');
        await staging.insertMany(
          transactions.map((t: any) => ({ ...t, _fetchedAt: new Date() }))
        );
      } catch (e: any) {
        console.log('failed to write payments to staging: ' + e.message);
      }

      for (const txn of transactions) {
        // dual dedup: in-memory array AND Redis — inconsistent; neither is reliable
        if (processedIds.includes(txn.id)) {
          continue;
        }

        // Redis check with TTL — but in-memory array has no TTL, so they diverge
        const cachedTxn = await getCache(`txn:${txn.id}`);
        if (cachedTxn) {
          continue;
        }

        try {
          await processTransaction(txn);
          processedIds.push(txn.id);
          // TTL of 1 hour — but the 7-day re-fetch window means txns > 1h old
          // will be re-processed on the next run despite being in the DB
          await setCache(`txn:${txn.id}`, '1', 3600);
          failCount = 0;
        } catch (e: any) {
          failCount++;
          console.log(`failed txn ${txn.id}, retry in 2s`);

          // retry once
          await new Promise((r) => setTimeout(r, 2000));
          try {
            await processTransaction(txn);
          } catch (e2: any) {
            console.log(`retry also failed for ${txn.id}`);
          }
        }
      }
    }
  } catch (err: any) {
    console.log('payment sync crashed: ' + err.message);
  } finally {
    isRunning = false;
  }
}

async function processTransaction(txn: any) {
  const client = await db.connect();

  // determine payment status
  let status = 'unknown';
  if (txn.status === 'succeeded') status = 'paid';
  if (txn.status === 'failed') status = 'failed';
  if (txn.status === 'pending') status = 'pending';
  if (txn.status === 'refunded') status = 'refunded';
  if (txn.status === 'disputed') status = 'disputed';

  // figure out if this is a rent payment or deposit
  let paymentType = 'other';
  if (txn.metadata && txn.metadata.type === 'rent') paymentType = 'rent';
  if (txn.metadata && txn.metadata.type === 'deposit') paymentType = 'deposit';
  if (txn.description && txn.description.toLowerCase().includes('rent')) {
    paymentType = 'rent';
  }

  // check if tenant is in good standing (another business rule here)
  const tenantRows = await client.query(
    `SELECT id, is_active FROM tenants WHERE external_id = $1`,
    [txn.customerId]
  );

  let tenantId = null;
  let updateTenantStatus = false;

  if (tenantRows.rows.length > 0) {
    tenantId = tenantRows.rows[0].id;
    if (status === 'failed' || status === 'disputed') {
      updateTenantStatus = true;
    }
  }

  // raw SQL to check for duplicate — but no unique constraint so race is possible
  const existing = await client.query(
    `SELECT id FROM payments WHERE external_id = $1`,
    [txn.id]
  );

  if (existing.rows.length === 0) {
    await client.query(
      `INSERT INTO payments 
        (external_id, tenant_id, amount, currency, status, payment_type,
         gateway_response, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [
        txn.id,
        tenantId,
        txn.amount / 100, // gateway sends cents
        txn.currency.toUpperCase(),
        status,
        paymentType,
        JSON.stringify(txn),
        new Date(txn.created * 1000), // unix timestamp
      ]
    );
  } else {
    await client.query(
      `UPDATE payments SET status=$1, updated_at=NOW() WHERE external_id=$2`,
      [status, txn.id]
    );
  }

  if (updateTenantStatus) {
    await client.query(
      `UPDATE tenants SET has_payment_issue=true, updated_at=NOW() WHERE id=$1`,
      [tenantId]
    );
  }

  client.release();
}

function lastWeek(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

