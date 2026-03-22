import { getCachedValue, setCachedValue } from "@/lib/runtime/runtimeCache";
import type { CacheSourceType, FreshnessClass, MarketRequestPriority } from "@/lib/marketData/types";

type MarketCacheEnvelope<T> = {
  key: string;
  provider: string | null;
  fetchedAt: number;
  freshUntil: number;
  staleUntil: number;
  degraded: boolean;
  priority: MarketRequestPriority;
  value: T;
};

const inflight = new Map<string, Promise<unknown>>();

function roundBucketStart(nowMs: number, bucketMs: number) {
  return Math.floor(nowMs / bucketMs) * bucketMs;
}

export function buildQuoteCacheKey(input: {
  provider: string;
  assetClass: string;
  symbol: string;
  bucketMs: number;
  nowMs?: number;
}) {
  const bucket = roundBucketStart(input.nowMs ?? Date.now(), input.bucketMs);
  return [
    "market",
    "quote",
    input.provider,
    input.assetClass,
    input.symbol,
    String(bucket),
  ].join(":");
}

export function buildCandleCacheKey(input: {
  provider: string;
  assetClass: string;
  symbol: string;
  timeframe: string;
  bucketMs: number;
  limit?: number;
  rangeKey?: string;
  nowMs?: number;
}) {
  const bucket = roundBucketStart(input.nowMs ?? Date.now(), input.bucketMs);
  return [
    "market",
    "candles",
    input.provider,
    input.assetClass,
    input.symbol,
    input.timeframe,
    String(bucket),
    String(input.limit ?? 0),
    input.rangeKey ?? "full",
  ].join(":");
}

export async function getCachedMarketValue<T>(key: string): Promise<{
  envelope: MarketCacheEnvelope<T>;
  freshnessClass: FreshnessClass;
  sourceType: CacheSourceType;
} | null> {
  const envelope = await getCachedValue<MarketCacheEnvelope<T>>(key);
  if (!envelope) {
    return null;
  }

  const now = Date.now();
  const freshnessClass: FreshnessClass =
    now <= envelope.freshUntil
      ? "fresh"
      : now <= envelope.staleUntil
        ? "stale"
        : "expired";

  if (freshnessClass === "expired") {
    return null;
  }

  return {
    envelope,
    freshnessClass,
    sourceType: freshnessClass === "fresh" ? "cache" : "stale-cache",
  };
}

export async function setCachedMarketValue<T>(
  key: string,
  value: T,
  input: {
    freshTtlMs: number;
    staleTtlMs: number;
    provider: string | null;
    degraded: boolean;
    priority: MarketRequestPriority;
  }
) {
  const fetchedAt = Date.now();
  const envelope: MarketCacheEnvelope<T> = {
    key,
    provider: input.provider,
    fetchedAt,
    freshUntil: fetchedAt + input.freshTtlMs,
    staleUntil: fetchedAt + input.staleTtlMs,
    degraded: input.degraded,
    priority: input.priority,
    value,
  };

  await setCachedValue(key, envelope, input.staleTtlMs);
}

export async function withInflightDedup<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    return existing as Promise<T>;
  }

  const promise = factory().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function peekInflight(key: string): Promise<unknown> | null {
  return inflight.get(key) ?? null;
}
