import { getCacheMode, getUpstashClient } from "@/lib/runtime/redis";

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
  // Memory cache is always checked first (avoids a round-trip)
  const memoryEntry = pruneMemory(key);
  if (memoryEntry) {
    try {
      return JSON.parse(memoryEntry.value) as T;
    } catch {
      memoryCache.delete(key);
    }
  }

  const client = getUpstashClient();
  if (!client) return null;

  try {
    // Upstash auto-deserialises JSON; no JSON.parse needed here.
    const value = await client.get<T>(key);
    if (value == null) return null;

    // Backfill the memory cache so subsequent reads are free.
    try {
      memoryCache.set(key, {
        value: JSON.stringify(value),
        expiresAt: Date.now() + 15_000,
      });
    } catch {
      // ignore serialisation errors — memory cache is best-effort
    }

    return value;
  } catch {
    return null;
  }
}

export async function setCachedValue<T>(key: string, value: T, ttlMs: number): Promise<void> {
  // Always write to memory cache synchronously
  try {
    memoryCache.set(key, {
      value: JSON.stringify(value),
      expiresAt: Date.now() + ttlMs,
    });
  } catch {
    // ignore
  }

  const client = getUpstashClient();
  if (!client) return;

  try {
    // Upstash uses { px: ms } instead of ioredis "PX" flag
    await client.set(key, value, { px: ttlMs });
  } catch {
    // optional cache backend — degrade gracefully
  }
}

export async function deleteCachedValue(key: string): Promise<void> {
  memoryCache.delete(key);

  const client = getUpstashClient();
  if (!client) return;

  try {
    await client.del(key);
  } catch {
    // optional cache backend
  }
}
