// config.ts

export const config = {
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: 5432,
    user: process.env.DB_USER || 'admin',
    password: process.env.DB_PASSWORD || 'admin123',
    database: 'platform_db',
  },

  pms: {
    baseUrl: 'https://api.propertymgmt.io/v1',
    apiKey: process.env.PMS_API_KEY,
    timeout: 30000,
  },

  payments: {
    baseUrl: 'https://payments.gateway.com/api',
    secretKey: process.env.PAYMENTS_SECRET_KEY,
    webhookSecret: process.env.PAYMENTS_WEBHOOK_SECRET,
    timeout: 30000,
  },

  university: {
    baseUrl: 'https://directory.university.edu/api/v2',
    clientId: process.env.UNIVERSITY_CLIENT_ID,
    clientSecret: process.env.UNIVERSITY_CLIENT_SECRET,
    timeout: 15000,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: 6379,
    password: process.env.REDIS_PASSWORD || '',
    ttl: 3600,
  },

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://admin:admin123@localhost:27017',
    database: 'platform_staging',
  },

  cron: {
    properties: '*/15 * * * *',
    payments: '*/10 * * * *',
    tenants: '0 * * * *',
  }
};
