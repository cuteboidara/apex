import IORedis from "ioredis";
import type { ConnectionOptions } from "bullmq";

const globalForRedis = globalThis as typeof globalThis & {
  __apexRedisClient?: IORedis | null;
  __apexMemoryCache?: Map<string, { value: string; expiresAt: number }>;
};
const REDIS_OPERATION_TIMEOUT_MS = 250;

function getMemoryCache() {
  globalForRedis.__apexMemoryCache ??= new Map();
  return globalForRedis.__apexMemoryCache;
}

export function getRedisUrl(): string | null {
  return process.env.REDIS_URL?.trim() || null;
}

export function isRedisConfigured(): boolean {
  return Boolean(getRedisUrl());
}

export function createRedisConnectionOptions(): ConnectionOptions {
  const rawUrl = getRedisUrl();
  if (!rawUrl) {
    throw new Error("REDIS_URL not configured");
  }

  const url = new URL(rawUrl);
  const db = url.pathname && url.pathname !== "/" ? Number(url.pathname.slice(1)) : undefined;

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: Number.isFinite(db) ? db : undefined,
    family: 0,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    connectTimeout: 10_000,
    retryStrategy: (attempts: number) => Math.min(250 * attempts, 2_000),
    tls: url.protocol === "rediss:" ? { servername: url.hostname } : undefined,
  };
}

export function getRedisClient(): IORedis | null {
  const rawUrl = getRedisUrl();
  if (!rawUrl) {
    return null;
  }

  if (!globalForRedis.__apexRedisClient) {
    globalForRedis.__apexRedisClient = new IORedis(rawUrl, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
      enableReadyCheck: false,
    });
  }

  return globalForRedis.__apexRedisClient;
}

async function withRedisTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>(resolve => {
      setTimeout(() => resolve(fallback), REDIS_OPERATION_TIMEOUT_MS);
    }),
  ]);
}

export async function getCachedJson<T>(key: string): Promise<T | null> {
  const memory = getMemoryCache().get(key);
  if (memory && memory.expiresAt >= Date.now()) {
    return JSON.parse(memory.value) as T;
  }
  getMemoryCache().delete(key);

  const client = getRedisClient();
  if (!client) {
    return null;
  }

  try {
    const value = await withRedisTimeout(client.get(key), null);
    if (!value) {
      return null;
    }
    getMemoryCache().set(key, {
      value,
      expiresAt: Date.now() + 60_000,
    });
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export async function setCachedJson<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const serialized = JSON.stringify(value);
  getMemoryCache().set(key, {
    value: serialized,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  const client = getRedisClient();
  if (!client) {
    return;
  }

  try {
    await withRedisTimeout(client.set(key, serialized, "EX", ttlSeconds), null);
  } catch {
    return;
  }
}

export function resetRedisStateForTests(): void {
  getMemoryCache().clear();
  globalForRedis.__apexRedisClient = null;
}
