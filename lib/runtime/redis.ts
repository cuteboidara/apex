import type { ConnectionOptions } from "bullmq";
import { Redis } from "@upstash/redis";

// ── BullMQ / ioredis-compatible config (unchanged) ───────────────────────────
// BullMQ requires a raw ioredis connection; it uses REDIS_URL (not Upstash REST).

export type RedisConfigSource =
  | "REDIS_URL"
  | "KV_URL"
  | "UPSTASH_REDIS_URL"
  | "UPSTASH_REDIS_TLS_URL";

export type RedisRuntimeConfig = {
  url: string | null;
  source: RedisConfigSource | null;
  restOnlyConfigured: boolean;
};

function resolveRedisConfig(): RedisRuntimeConfig {
  const candidates = [
    { source: "REDIS_URL" as const,               value: process.env.REDIS_URL               ?? null },
    { source: "KV_URL" as const,                  value: process.env.KV_URL                  ?? null },
    { source: "UPSTASH_REDIS_URL" as const,       value: process.env.UPSTASH_REDIS_URL       ?? null },
    { source: "UPSTASH_REDIS_TLS_URL" as const,   value: process.env.UPSTASH_REDIS_TLS_URL   ?? null },
  ];

  const configured = candidates.find(candidate => Boolean(candidate.value));
  if (configured) {
    return { url: configured.value, source: configured.source, restOnlyConfigured: false };
  }

  return {
    url: null,
    source: null,
    restOnlyConfigured: Boolean(
      process.env.KV_REST_API_URL ||
      process.env.UPSTASH_REDIS_REST_URL ||
      process.env.UPSTASH_REDIS_REST_TOKEN
    ),
  };
}

const redisConfig = resolveRedisConfig();

export function getRedisConfiguration(): RedisRuntimeConfig {
  return redisConfig;
}

/** True when a raw ioredis-compatible URL is available (needed for BullMQ). */
export function isRedisConfigured(): boolean {
  return Boolean(redisConfig.url);
}

function buildTlsOptions(url: URL) {
  if (url.protocol !== "rediss:") return undefined;
  return { servername: url.hostname };
}

/** Returns ioredis-compatible ConnectionOptions for BullMQ. */
export function createRedisConnectionOptions(): ConnectionOptions {
  if (!redisConfig.url) {
    throw new Error("Redis not configured");
  }

  const url = new URL(redisConfig.url);
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
    retryStrategy: (times: number) => Math.min(times * 250, 2_000),
    tls: buildTlsOptions(url),
  };
}

// ── Upstash Redis REST client (for caching, rate limiting) ───────────────────

const globalForUpstash = globalThis as typeof globalThis & {
  __apexUpstashClient?: Redis | null;
};

/** True when Upstash REST credentials are present. */
export function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

export function getUpstashClient(): Redis | null {
  if (!isUpstashConfigured()) return null;

  if (!globalForUpstash.__apexUpstashClient) {
    globalForUpstash.__apexUpstashClient = new Redis({
      url:   process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }

  return globalForUpstash.__apexUpstashClient;
}

/** Named export matching the spec: `import { redis } from "@/lib/runtime/redis"` */
export const redis: Redis | null = (() => getUpstashClient())();

/** Cache mode is "redis" when Upstash REST credentials are present. */
export function getCacheMode(): "redis" | "memory" {
  return isUpstashConfigured() ? "redis" : "memory";
}
