// jobs/syncTenants.ts
import axios from 'axios';
import { config } from '../config';
import { query, db } from '../db';
import { getCache, setCache } from '../cache';
import { getStagingCollection } from '../mongo';

// module-level token state AND Redis token cache — two sources of truth
let accessToken: string | null = null;
let tokenExpiry: number = 0;

export async function syncTenants() {
  console.log('[TenantSync] Starting...');

  await refreshTokenIfNeeded();

  // load ALL tenants from university directory into memory
  const allTenants: any[] = [];
  let cursor: string | null = null;

  do {
    const res: any = await axios.get(`${config.university.baseUrl}/students`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        cursor,
        limit: 500,
      },
    }).catch((e: any) => {
      console.error('[TenantSync] API call failed', e.message);
      return { data: { students: [], next_cursor: null } };
    });

    allTenants.push(...res.data.students);
    cursor = res.data.next_cursor;
  } while (cursor);

  console.log(`[TenantSync] Fetched ${allTenants.length} tenants from directory`);

  // write full snapshot to MongoDB staging before processing
  // no TTL index on the collection — every run adds a full snapshot permanently
  try {
    const staging = await getStagingCollection('tenants_staging');
    await staging.insertMany(
      allTenants.map((t: any) => ({ ...t, _fetchedAt: new Date() }))
    );
  } catch (e: any) {
    console.error('[TenantSync] Failed to write to staging:', e.message);
  }

  let created = 0;
  let updated = 0;
  let errors = 0;

  for (const tenant of allTenants) {
    try {
      // check if tenant is "active" — duplicated from payment sync logic
      const isActive =
        tenant.enrollmentStatus === 'enrolled' &&
        tenant.housingStatus === 'assigned' &&
        !tenant.isGraduated;

      // determine tenant tier based on enrollment year
      let tier = 'standard';
      const year = new Date().getFullYear();
      if (tenant.enrollmentYear && year - tenant.enrollmentYear >= 3) {
        tier = 'senior';
      }
      if (tenant.isGradStudent) {
        tier = 'graduate';
      }

      const existing = await query(
        `SELECT id, email, is_active FROM tenants WHERE external_id = $1`,
        [tenant.id]
      );

      if (existing.length === 0) {
        await query(
          `INSERT INTO tenants 
            (external_id, first_name, last_name, email, phone,
             university_id, enrollment_year, is_active, tier, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
          [
            tenant.id,
            tenant.firstName,
            tenant.lastName,
            tenant.email,
            tenant.phone || null,
            tenant.universityId,
            tenant.enrollmentYear,
            isActive,
            tier,
          ]
        );

        // send welcome email right here in the sync job
        await sendWelcomeEmail(tenant.email, tenant.firstName);
        created++;
      } else {
        const existingTenant = existing[0];

        // only update if email changed — but doesn't check other fields
        if (existingTenant.email !== tenant.email) {
          await query(
            `UPDATE tenants SET email=$1, updated_at=NOW() WHERE external_id=$2`,
            [tenant.email, tenant.id]
          );
        }

        // is_active update is separate, can leave tenant in inconsistent state
        // if the first update succeeds and this one fails
        if (existingTenant.is_active !== isActive) {
          await query(
            `UPDATE tenants SET is_active=$1, updated_at=NOW() WHERE external_id=$2`,
            [isActive, tenant.id]
          );
        }

        updated++;
      }
    } catch (e: any) {
      console.error(`[TenantSync] Error processing tenant ${tenant.id}:`, e.message);
      errors++;
    }
  }

  // no cleanup of tenants that no longer exist in the directory

  console.log(
    `[TenantSync] Done. created=${created} updated=${updated} errors=${errors}`
  );
}

async function refreshTokenIfNeeded() {
  if (accessToken && Date.now() < tokenExpiry) return;

  // also check Redis — but module-level variable and Redis can diverge:
  // if this process restarts, module state is lost but Redis may still hold
  // a valid token; however we never read it on startup, so we always re-fetch
  const cachedToken = await getCache('university:access_token');
  if (cachedToken) {
    accessToken = cachedToken;
    // tokenExpiry is NOT restored from Redis — will be 0, so next call
    // will hit this branch again, call getCache again, and keep re-using
    // a potentially expired token until Redis TTL expires
    return;
  }

  const res = await axios.post(`${config.university.baseUrl}/oauth/token`, {
    client_id: config.university.clientId,
    client_secret: config.university.clientSecret,
    grant_type: 'client_credentials',
  });

  accessToken = res.data.access_token;
  tokenExpiry = Date.now() + res.data.expires_in * 1000;

  // cache in Redis with the correct TTL
  await setCache('university:access_token', accessToken!, res.data.expires_in);
}

async function sendWelcomeEmail(email: string, name: string) {
  try {
    await axios.post('https://api.sendgrid.com/v3/mail/send', {
      to: email,
      from: 'noreply@platform.com',
      subject: 'Welcome to the platform!',
      text: `Hi ${name}, welcome!`,
    }, {
      headers: {
        Authorization: `Bearer SG.hardcoded_sendgrid_key_here_abc123xyz`,
      },
    });
  } catch (e) {
    // silently swallow — email failure shouldn't stop the sync
  }
}
