import type { OrchestratedCandles, OrchestratedQuote } from "@/lib/marketData/types";

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const quoteCache = new Map<string, CacheEntry<OrchestratedQuote>>();
const candleCache = new Map<string, CacheEntry<OrchestratedCandles>>();

function getEntry<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, ttlMs: number, value: T) {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

export function getCachedQuote(key: string) {
  return getEntry(quoteCache, key);
}

export function setCachedQuote(key: string, ttlMs: number, value: OrchestratedQuote) {
  setEntry(quoteCache, key, ttlMs, value);
}

export function getCachedCandles(key: string) {
  return getEntry(candleCache, key);
}

export function setCachedCandles(key: string, ttlMs: number, value: OrchestratedCandles) {
  setEntry(candleCache, key, ttlMs, value);
}
