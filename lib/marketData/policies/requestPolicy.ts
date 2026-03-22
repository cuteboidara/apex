import { getCandleFreshnessMs, getQuoteFreshnessMs } from "@/lib/marketData/policies/freshnessPolicy";
import type { AssetClass, MarketRequestPriority, Timeframe } from "@/lib/marketData/types";

export type MarketRequestContext = {
  priority?: MarketRequestPriority;
  consumer?: "chart" | "dashboard" | "signal-cycle" | "detail" | "background";
  allowBackgroundRefresh?: boolean;
};

export type MarketRequestPolicy = {
  priority: MarketRequestPriority;
  freshTtlMs: number;
  staleTtlMs: number;
  allowStaleWhileRevalidate: boolean;
  allowBackgroundRefresh: boolean;
  allowRareFallback: boolean;
  bucketMs: number;
};

function normalizePriority(context: MarketRequestContext | undefined): MarketRequestPriority {
  if (context?.priority) return context.priority;
  if (context?.consumer === "chart" || context?.consumer === "detail") return "hot";
  if (context?.consumer === "background" || context?.consumer === "signal-cycle") return "cold";
  return "warm";
}

function envMs(name: string, fallback: number) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveQuoteRequestPolicy(
  assetClass: AssetClass,
  context?: MarketRequestContext
): MarketRequestPolicy {
  const priority = normalizePriority(context);
  const baseFreshness = getQuoteFreshnessMs(assetClass);
  const freshTtlMs =
    priority === "hot"
      ? envMs("APEX_MARKET_HOT_QUOTE_TTL_MS", Math.max(5_000, Math.floor(baseFreshness / 2)))
      : priority === "warm"
        ? envMs("APEX_MARKET_WARM_QUOTE_TTL_MS", baseFreshness)
        : envMs("APEX_MARKET_COLD_QUOTE_TTL_MS", Math.max(baseFreshness, 3 * 60_000));
  const staleTtlMs =
    priority === "hot"
      ? envMs("APEX_MARKET_HOT_QUOTE_STALE_TTL_MS", Math.max(baseFreshness * 4, 2 * 60_000))
      : priority === "warm"
        ? envMs("APEX_MARKET_WARM_QUOTE_STALE_TTL_MS", Math.max(baseFreshness * 6, 5 * 60_000))
        : envMs("APEX_MARKET_COLD_QUOTE_STALE_TTL_MS", Math.max(baseFreshness * 10, 15 * 60_000));

  return {
    priority,
    freshTtlMs,
    staleTtlMs,
    allowStaleWhileRevalidate: true,
    allowBackgroundRefresh: context?.allowBackgroundRefresh ?? priority !== "cold",
    allowRareFallback: priority === "hot",
    bucketMs: Math.max(5_000, freshTtlMs),
  };
}

export function resolveCandleRequestPolicy(
  timeframe: Timeframe,
  context?: MarketRequestContext
): MarketRequestPolicy {
  const priority = normalizePriority(context);
  const baseFreshness = getCandleFreshnessMs(timeframe);
  const freshTtlMs =
    priority === "hot"
      ? envMs("APEX_MARKET_HOT_CANDLE_TTL_MS", Math.max(10_000, Math.floor(baseFreshness / 2)))
      : priority === "warm"
        ? envMs("APEX_MARKET_WARM_CANDLE_TTL_MS", baseFreshness)
        : envMs("APEX_MARKET_COLD_CANDLE_TTL_MS", Math.max(baseFreshness, 10 * 60_000));
  const staleTtlMs =
    priority === "hot"
      ? envMs("APEX_MARKET_HOT_CANDLE_STALE_TTL_MS", Math.max(baseFreshness * 4, 15 * 60_000))
      : priority === "warm"
        ? envMs("APEX_MARKET_WARM_CANDLE_STALE_TTL_MS", Math.max(baseFreshness * 8, 60 * 60_000))
        : envMs("APEX_MARKET_COLD_CANDLE_STALE_TTL_MS", Math.max(baseFreshness * 16, 6 * 60 * 60_000));

  return {
    priority,
    freshTtlMs,
    staleTtlMs,
    allowStaleWhileRevalidate: true,
    allowBackgroundRefresh: context?.allowBackgroundRefresh ?? priority !== "cold",
    allowRareFallback: priority === "hot",
    bucketMs: Math.max(freshTtlMs, 30_000),
  };
}
