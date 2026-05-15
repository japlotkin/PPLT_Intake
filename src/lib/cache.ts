/**
 * Hourly server-side cache, backed by Vercel KV when available.
 * Falls back to an in-process Map during local dev / when KV is unset --
 * fine for a single dev server, useless on Vercel without KV.
 *
 * Cache keys are scoped per date-range so different presets don't collide.
 */
import { kv } from "@vercel/kv";
import { env } from "./env";

const FALLBACK_TTL_MS = 60 * 60 * 1000;
const memCache = new Map<string, { value: unknown; expires: number }>();

export const ONE_HOUR_SECONDS = 60 * 60;

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (env.kv.enabled()) {
    const v = (await kv.get<T>(key)) ?? null;
    return v;
  }
  const hit = memCache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    memCache.delete(key);
    return null;
  }
  return hit.value as T;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds = ONE_HOUR_SECONDS
): Promise<void> {
  if (env.kv.enabled()) {
    await kv.set(key, value, { ex: ttlSeconds });
    return;
  }
  memCache.set(key, {
    value,
    expires: Date.now() + Math.min(ttlSeconds * 1000, FALLBACK_TTL_MS),
  });
}

export async function cacheDelete(key: string): Promise<void> {
  if (env.kv.enabled()) {
    await kv.del(key);
    return;
  }
  memCache.delete(key);
}

/** Clear all dashboard cache entries (used by /api/refresh). */
export async function cacheClearAll(): Promise<number> {
  if (env.kv.enabled()) {
    const keys = await kv.keys("dash:*");
    if (keys.length === 0) return 0;
    await Promise.all(keys.map((k) => kv.del(k)));
    return keys.length;
  }
  const n = memCache.size;
  memCache.clear();
  return n;
}

/** Run `fn` once per ttl window, key it by `key`. */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await fn();
  await cacheSet(key, value, ttlSeconds);
  return value;
}
