// jobs/syncProperties.ts
import axios from 'axios';
import { config } from '../config';
import { query } from '../db';
import { getCache, setCache } from '../cache';
import { getStagingCollection } from '../mongo';

let lastSyncTime: any = null;

export async function syncProperties() {
  console.log('starting property sync...');

  let properties: any;

  try {
    const res = await axios.get(`${config.pms.baseUrl}/listings`, {
      headers: {
        'X-API-Key': config.pms.apiKey,
      },
    });
    properties = res.data.listings;
  } catch (e: any) {
    console.log('failed to fetch properties: ' + e.message);
    return;
  }

  console.log(`got ${properties.length} properties`);

  // write raw API response to MongoDB staging — no TTL, grows forever
  try {
    const staging = await getStagingCollection('properties_staging');
    await staging.insertMany(
      properties.map((p: any) => ({ ...p, _fetchedAt: new Date() }))
    );
  } catch (e: any) {
    // staging failure is silently swallowed — processing continues regardless
    console.log('failed to write to staging: ' + e.message);
  }

  for (const p of properties) {
    try {
      // check Redis to see if this property was recently processed
      // but key has no TTL, so it never expires — re-syncs are permanently skipped
      const cached = await getCache(`property:${p.id}`);
      if (cached) {
        continue;
      }

      // fetch amenities for each property
      const amenitiesRes = await axios.get(
        `${config.pms.baseUrl}/listings/${p.id}/amenities`,
        { headers: { 'X-API-Key': config.pms.apiKey } }
      );
      p.amenities = amenitiesRes.data;

      // figure out pricing tier
      let pricingTier = 'standard';
      if (p.monthlyRent > 3000) {
        pricingTier = 'premium';
      } else if (p.monthlyRent > 1500) {
        pricingTier = 'mid';
      }

      if (p.monthlyRent > 5000 && p.amenities.includes('concierge')) {
        pricingTier = 'luxury';
      }

      // check if available
      let isAvailable = false;
      if (p.status === 'available' && p.availableFrom) {
        const availDate = new Date(p.availableFrom);
        if (availDate <= new Date()) {
          isAvailable = true;
        }
      }

      // calculate platform fee
      let platformFee = p.monthlyRent * 0.03;
      if (pricingTier === 'luxury') {
        platformFee = p.monthlyRent * 0.05;
      }
      if (p.isPartner === true) {
        platformFee = platformFee * 0.8;
      }

      await query(
        `INSERT INTO properties 
          (external_id, title, address, monthly_rent, pricing_tier, 
           platform_fee, is_available, amenities, raw_data, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [
          p.id,
          p.title,
          p.address,
          p.monthlyRent,
          pricingTier,
          platformFee,
          isAvailable,
          JSON.stringify(p.amenities),
          JSON.stringify(p),
        ]
      );

      // cache property as processed — no TTL, so updated properties are
      // never re-synced until the Redis key is manually deleted
      await setCache(`property:${p.id}`, '1');

      console.log('saved property ' + p.id);
    } catch (err: any) {
      console.log('error on property ' + p.id + ': ' + err.message);
      continue;
    }

    // be nice to the API
    await new Promise((r) => setTimeout(r, 200));
  }

  lastSyncTime = new Date();
  console.log('property sync done');
}

