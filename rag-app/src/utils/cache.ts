import crypto from 'node:crypto';
import { createClient } from 'redis';
import pLimit from 'p-limit';

let redisClient: any = null;
let isRedisConnected = false;

// Initialize Redis if configured and available
async function getRedisClient() {
  if (redisClient === null) {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        const client = createClient({ url: redisUrl });
        client.on('error', (err) => {
          // Suppress errors to prevent process crashes if Redis dies mid-run
          console.warn('Redis client error:', err.message);
        });
        await client.connect();
        redisClient = client;
        isRedisConnected = true;
        console.log('Connected to Redis for caching.');
      } catch (err) {
        console.warn(`Redis connection failed. Using in-memory fallback cache. Error: ${(err as Error).message}`);
        redisClient = false;
      }
    } else {
      redisClient = false;
    }
  }
  return isRedisConnected ? redisClient : null;
}

// In-memory fallback cache
const memoryCache = new Map<string, { value: any; expiresAt: number }>();

const hashKey = (ns: string, s: string) => `${ns}:${crypto.createHash('sha256').update(s).digest('hex')}`;

/**
 * Caches responses. Skips generation if an identical question has been asked.
 * Scoped by namespace or tenant (prefixing the question).
 */
export async function cachedAnswer<T>(
  question: string,
  produce: () => Promise<T>,
  ttlSec = 3600
): Promise<T> {
  const cacheKey = hashKey('answer', question);

  // Try Redis cache
  try {
    const redis = await getRedisClient();
    if (redis) {
      const hit = await redis.get(cacheKey);
      if (hit) {
        console.log('[Cache] Redis hit for question.');
        return JSON.parse(hit) as T;
      }
      const value = await produce();
      await redis.set(cacheKey, JSON.stringify(value), { EX: ttlSec });
      return value;
    }
  } catch (err) {
    console.warn(`Redis cache failed, falling back to memory. Error: ${(err as Error).message}`);
  }

  // Fallback memory cache
  const now = Date.now();
  const memoryHit = memoryCache.get(cacheKey);
  if (memoryHit && memoryHit.expiresAt > now) {
    console.log('[Cache] In-memory hit for question.');
    return memoryHit.value as T;
  }

  const value = await produce();
  memoryCache.set(cacheKey, { value, expiresAt: now + ttlSec * 1000 });
  return value;
}

/**
 * Concurrency limiter to cap how many expensive model operations
 * run simultaneously, preventing API rate limit starvation under high concurrency.
 */
export const llmLimit = pLimit(Number(process.env.LLM_CONCURRENCY ?? 5));
