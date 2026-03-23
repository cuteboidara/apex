import type { AssetClass, Timeframe } from "@/lib/marketData/types";

const QUOTE_FRESHNESS_MS: Record<AssetClass, number> = {
  CRYPTO: 30_000,
  FOREX: 60_000,
  COMMODITY: 60_000,
};

const CANDLE_FRESHNESS_MS: Record<Timeframe, number> = {
  "1m": 2 * 60_000,
  "5m": 10 * 60_000,
  "15m": 25 * 60_000,
  "1h": 90 * 60_000,
  "4h": 5 * 60 * 60_000,
  "1D": 30 * 60 * 60_000,
};

export function getQuoteStalenessWindowMs(assetClass: AssetClass) {
  return QUOTE_FRESHNESS_MS[assetClass];
}

export function getCandleStalenessWindowMs(timeframe: Timeframe) {
  return CANDLE_FRESHNESS_MS[timeframe];
}

export function classifyFreshness(
  timestamp: number | null | undefined,
  maxFreshnessMs: number
): { freshnessMs: number | null; freshnessClass: "fresh" | "stale" | "expired" } {
  if (timestamp == null || !Number.isFinite(timestamp)) {
    return { freshnessMs: null, freshnessClass: "expired" };
  }

  const freshnessMs = Math.max(0, Date.now() - timestamp);
  if (freshnessMs <= maxFreshnessMs) {
    return { freshnessMs, freshnessClass: "fresh" };
  }

  if (freshnessMs <= maxFreshnessMs * 4) {
    return { freshnessMs, freshnessClass: "stale" };
  }

  return { freshnessMs, freshnessClass: "expired" };
}
