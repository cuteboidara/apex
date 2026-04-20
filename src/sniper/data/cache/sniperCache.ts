type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export function getSniperCache<T>(key: string): T | null {
  const row = cache.get(key);
  if (!row) return null;

  if (Date.now() > row.expiresAt) {
    cache.delete(key);
    return null;
  }

  return row.value as T;
}

export function setSniperCache<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

