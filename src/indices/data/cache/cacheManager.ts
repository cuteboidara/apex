// src/indices/data/cache/cacheManager.ts
// Redis-backed cache with in-memory fallback

import { getCachedJson, setCachedJson } from '@/src/lib/redis';

// In-memory fallback if Redis is unavailable
const memoryCache = new Map<string, { value: unknown; expiresAt: number }>();

export async function getCache<T>(key: string): Promise<T | null> {
  // Try Redis first
  try {
    const cached = await getCachedJson<T>(key);
    if (cached != null) return cached;
  } catch {
    // fall through to memory cache
  }

  // Fallback: memory cache
  const entry = memoryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value as T;
  }
  if (entry) {
    memoryCache.delete(key);
  }
  return null;
}

export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  // Write to Redis
  try {
    await setCachedJson(key, value, ttlSeconds);
  } catch {
    // fall through to memory cache
  }

  // Always write to memory cache as backup
  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function invalidateCache(key: string): Promise<void> {
  memoryCache.delete(key);
  // Redis expiry handles the rest; no explicit delete needed for this use case
}

// ─── Cache Key Builders ───────────────────────────────────────────────────────

export const CacheKeys = {
  candles: (symbol: string, timeframe: string) =>
    `indices:candles:${symbol}:${timeframe}:v1`,
  macro: () => 'indices:macro:v1',
  dxy: () => 'indices:macro:dxy:v1',
  vix: () => 'indices:macro:vix:v1',
  yields: () => 'indices:macro:yields:v1',
  sentiment: () => 'indices:macro:sentiment:v1',
  calendar: () => 'indices:macro:calendar:v1',
  correlations: () => 'indices:quant:correlations:v1',
  signals: () => 'indices:signals:latest:v1',
} as const;

// ─── TTL Constants (seconds) ──────────────────────────────────────────────────

export const CacheTTL = {
  candles: 300,       // 5 min
  dxy: 600,           // 10 min
  vix: 600,           // 10 min
  yields: 3600,       // 1 hour
  sentiment: 3600,    // 1 hour
  calendar: 1800,     // 30 min
  correlations: 900,  // 15 min
  signals: 300,       // 5 min
} as const;
