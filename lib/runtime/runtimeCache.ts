import { getCacheMode, getRedisClient } from "@/lib/runtime/redis";

type MemoryEntry = {
  expiresAt: number;
  value: string;
};

const memoryCache = new Map<string, MemoryEntry>();

function pruneMemory(key: string) {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return null;
  }
  return entry;
}

export function getRuntimeCacheMode(): "redis" | "memory" {
  return getCacheMode();
}

export async function getCachedValue<T>(key: string): Promise<T | null> {
  const memoryEntry = pruneMemory(key);
  if (memoryEntry) {
    try {
      return JSON.parse(memoryEntry.value) as T;
    } catch {
      memoryCache.delete(key);
    }
  }

  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  try {
    const raw = await redis.get(key);
    if (!raw) return null;

    memoryCache.set(key, {
      value: raw,
      expiresAt: Date.now() + 15_000,
    });
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setCachedValue<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const raw = JSON.stringify(value);

  memoryCache.set(key, {
    value: raw,
    expiresAt: Date.now() + ttlMs,
  });

  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.set(key, raw, "PX", ttlMs);
  } catch {
    // optional cache backend
  }
}

export async function deleteCachedValue(key: string): Promise<void> {
  memoryCache.delete(key);
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    await redis.del(key);
  } catch {
    // optional cache backend
  }
}
