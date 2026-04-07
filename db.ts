// db.ts
import { Pool } from 'pg';
import { config } from './config';

export const db = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
});

export async function query(sql: string, params?: any[]) {
  const result = await db.query(sql, params);
  return result.rows;
}
