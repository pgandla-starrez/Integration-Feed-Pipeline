// cache.ts
import Redis from 'ioredis';
import { config } from './config';

// client created eagerly at module load — no error handler attached,
// so a Redis connection failure will emit an unhandled 'error' event
export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
  // no retryStrategy — defaults to reconnecting forever
  // no lazyConnect — connects immediately on import
});

export async function getCache(key: string): Promise<string | null> {
  return redis.get(key);
}

export async function setCache(key: string, value: string, ttlSeconds?: number) {
  if (ttlSeconds) {
    await redis.set(key, value, 'EX', ttlSeconds);
  } else {
    // no TTL — keys accumulate forever unless manually evicted
    await redis.set(key, value);
  }
}

export async function deleteCache(key: string) {
  await redis.del(key);
}
