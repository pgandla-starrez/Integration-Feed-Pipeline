// index.ts
import cron from 'node-cron';
import { syncProperties } from './jobs/syncProperties';
import { syncPayments } from './jobs/syncPayments';
import { syncTenants } from './jobs/syncTenants';
import { config } from './config';

console.log('Starting sync service...');

cron.schedule(config.cron.properties, async () => {
  console.log('Running property sync cron');
  await syncProperties();
});

cron.schedule(config.cron.payments, async () => {
  console.log('Running payment sync cron');
  await syncPayments();
});

cron.schedule(config.cron.tenants, async () => {
  console.log('Running tenant sync cron');
  await syncTenants();
});

console.log('Sync service started');
