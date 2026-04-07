// jobs/syncProperties.ts
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { config } from '../config';
import { query } from '../db';
import { getCache, setCache } from '../cache';
import { getStagingCollection } from '../mongo';

let lastSyncTime: any = null;

export async function syncProperties() {
  console.log('starting property sync...');

  let properties: any;

  try {
    // PMS delivers a large XML feed — entire response body buffered into memory
    // before parsing begins. A 50MB feed = 50MB+ heap spike per run.
    // Should stream and parse incrementally (e.g. sax-parser or xml-stream).
    const res = await axios.get(`${config.pms.baseUrl}/listings/feed.xml`, {
      headers: {
        'X-API-Key': config.pms.apiKey,
        'Accept': 'application/xml',
      },
      // responseType not set — axios buffers the full XML as a string by default
      timeout: config.pms.timeout,
    });

    // parse entire XML string at once — no streaming, no size guard
    const parsed = await parseStringPromise(res.data, {
      explicitArray: false,  // silently collapses repeated XML elements into
                              // a single object — if PMS returns multiple <Amenity>
                              // nodes they become one string, not an array
      ignoreAttrs: false,
    });

    // fragile path — assumes a fixed XML structure; any schema change silently
    // returns undefined and properties.forEach below throws
    properties = parsed?.PropertyFeed?.Listings?.Listing;

    // if the feed has a single listing, xml2js returns an object not an array
    // — this is never normalised, so the for..of loop breaks on single-listing feeds
    if (!Array.isArray(properties)) {
      properties = properties ? [properties] : [];
    }
  } catch (e: any) {
    console.log('failed to fetch or parse XML feed: ' + e.message);
    return;
  }

  console.log(`got ${properties.length} properties`);

  // write raw parsed JSON to MongoDB staging — no TTL, grows forever
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
      // xml2js wraps text nodes as objects when ignoreAttrs:false — e.g.
      // p.id may be { _: '123', '$': { type: 'uuid' } } not a plain string.
      // Accessing p.id directly yields [object Object] as the DB external_id.
      const externalId = p.id?._ ?? p.id;
      const monthlyRent = parseFloat(p.monthlyRent?._ ?? p.monthlyRent ?? '0');

      // check Redis to see if this property was recently processed
      // but key has no TTL, so it never expires — re-syncs are permanently skipped
      const cached = await getCache(`property:${externalId}`);
      if (cached) {
        continue;
      }

      // fetch amenities for each property — N+1 calls, same as before
      const amenitiesRes = await axios.get(
        `${config.pms.baseUrl}/listings/${externalId}/amenities`,
        { headers: { 'X-API-Key': config.pms.apiKey } }
      );
      p.amenities = amenitiesRes.data;

      // figure out pricing tier
      let pricingTier = 'standard';
      if (monthlyRent > 3000) {
        pricingTier = 'premium';
      } else if (monthlyRent > 1500) {
        pricingTier = 'mid';
      }

      if (monthlyRent > 5000 && p.amenities.includes('concierge')) {
        pricingTier = 'luxury';
      }

      // check if available
      let isAvailable = false;
      const status = p.status?._ ?? p.status;
      const availableFrom = p.availableFrom?._ ?? p.availableFrom;
      if (status === 'available' && availableFrom) {
        const availDate = new Date(availableFrom);
        if (availDate <= new Date()) {
          isAvailable = true;
        }
      }

      // calculate platform fee
      let platformFee = monthlyRent * 0.03;
      if (pricingTier === 'luxury') {
        platformFee = monthlyRent * 0.05;
      }
      if (p.isPartner === 'true' || p.isPartner === true) {
        // XML values are always strings — loose comparison masks type mismatch
        platformFee = platformFee * 0.8;
      }

      await query(
        `INSERT INTO properties 
          (external_id, title, address, monthly_rent, pricing_tier, 
           platform_fee, is_available, amenities, raw_data, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
        [
          externalId,
          p.title?._ ?? p.title,
          p.address?._ ?? p.address,
          monthlyRent,
          pricingTier,
          platformFee,
          isAvailable,
          JSON.stringify(p.amenities),
          JSON.stringify(p),
        ]
      );

      // cache property as processed — no TTL, so updated properties are
      // never re-synced until the Redis key is manually deleted
      await setCache(`property:${externalId}`, '1');

      console.log('saved property ' + externalId);
    } catch (err: any) {
      console.log('error on property ' + (p.id?._ ?? p.id) + ': ' + err.message);
      continue;
    }

    // be nice to the API
    await new Promise((r) => setTimeout(r, 200));
  }

  lastSyncTime = new Date();
  console.log('property sync done');
}

