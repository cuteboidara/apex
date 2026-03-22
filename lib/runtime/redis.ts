import type { ConnectionOptions } from "bullmq";
import Redis from "ioredis";

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

const globalForRedis = globalThis as typeof globalThis & {
  __apexRedisClient?: Redis | null;
};

function resolveRedisConfig(): RedisRuntimeConfig {
  const candidates = [
    { source: "REDIS_URL" as const, value: process.env.REDIS_URL ?? null },
    { source: "KV_URL" as const, value: process.env.KV_URL ?? null },
    { source: "UPSTASH_REDIS_URL" as const, value: process.env.UPSTASH_REDIS_URL ?? null },
    { source: "UPSTASH_REDIS_TLS_URL" as const, value: process.env.UPSTASH_REDIS_TLS_URL ?? null },
  ];

  const configured = candidates.find(candidate => Boolean(candidate.value));
  if (configured) {
    return {
      url: configured.value,
      source: configured.source,
      restOnlyConfigured: false,
    };
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

export function isRedisConfigured(): boolean {
  return Boolean(redisConfig.url);
}

function buildTlsOptions(url: URL) {
  if (url.protocol !== "rediss:") return undefined;
  return {
    servername: url.hostname,
  };
}

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
    retryStrategy: times => Math.min(times * 250, 2_000),
    tls: buildTlsOptions(url),
  };
}

export function getRedisClient(): Redis | null {
  if (!redisConfig.url) {
    return null;
  }

  if (!globalForRedis.__apexRedisClient) {
    const url = new URL(redisConfig.url);
    const client = new Redis(redisConfig.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      connectTimeout: 10_000,
      retryStrategy: times => Math.min(times * 250, 2_000),
      tls: buildTlsOptions(url),
    });

    client.on("error", () => {
      // Redis is optional; cache and queue callers degrade gracefully.
    });

    globalForRedis.__apexRedisClient = client;
  }

  return globalForRedis.__apexRedisClient;
}

export function getCacheMode(): "redis" | "memory" {
  return redisConfig.url ? "redis" : "memory";
}
