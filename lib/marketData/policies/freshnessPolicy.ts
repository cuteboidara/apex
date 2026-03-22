import type { AssetClass, CandleResult, QuoteResult, Style, Timeframe } from "@/lib/marketData/types";

const QUOTE_FRESHNESS_MS: Record<AssetClass, number> = {
  CRYPTO: 30_000,
  FOREX: 60_000,
  COMMODITY: 60_000,
};

const CANDLE_FRESHNESS_MS: Record<Timeframe, number> = {
  "1m": 15 * 60_000,
  "5m": 30 * 60_000,
  "15m": 60 * 60_000,
  "1h": 75 * 60_000,
  "4h": 5 * 60 * 60_000,
  "1D": 30 * 60 * 60_000,
};

const STYLE_REQUIREMENTS: Record<Style, Timeframe[]> = {
  SCALP: ["1m", "5m"],
  INTRADAY: ["5m", "15m", "1h"],
  SWING: ["1h", "4h", "1D"],
};

export function getQuoteFreshnessMs(assetClass: AssetClass): number {
  return QUOTE_FRESHNESS_MS[assetClass];
}

export function getCandleFreshnessMs(timeframe: Timeframe): number {
  return CANDLE_FRESHNESS_MS[timeframe];
}

export function isQuoteFresh(quote: Pick<QuoteResult, "assetClass" | "timestamp" | "price">): { fresh: boolean; freshnessMs: number | null } {
  if (quote.timestamp == null || quote.price == null || quote.price <= 0) {
    return { fresh: false, freshnessMs: null };
  }

  const freshnessMs = Date.now() - quote.timestamp;
  return {
    fresh: freshnessMs <= QUOTE_FRESHNESS_MS[quote.assetClass],
    freshnessMs,
  };
}

export function isCandleFresh(candles: Pick<CandleResult, "timestamp" | "timeframe">): { fresh: boolean; freshnessMs: number | null } {
  if (candles.timestamp == null) {
    return { fresh: false, freshnessMs: null };
  }

  const freshnessMs = Date.now() - candles.timestamp;
  return {
    fresh: freshnessMs <= CANDLE_FRESHNESS_MS[candles.timeframe],
    freshnessMs,
  };
}

export function evaluateStyleReadiness(results: Partial<Record<Timeframe, Pick<CandleResult, "timestamp" | "timeframe" | "marketStatus">>>) {
  return (Object.entries(STYLE_REQUIREMENTS) as Array<[Style, Timeframe[]]>).reduce<Record<Style, { ready: boolean; missing: Timeframe[]; stale: Timeframe[] }>>(
    (acc, [style, required]) => {
      const missing: Timeframe[] = [];
      const stale: Timeframe[] = [];

      for (const timeframe of required) {
        const result = results[timeframe];
        if (!result) {
          missing.push(timeframe);
          continue;
        }
        const freshness = isCandleFresh({ timestamp: result.timestamp ?? null, timeframe });
        const usableStatus =
          result.marketStatus === "LIVE" ||
          result.marketStatus === "DEGRADED";
        if (!freshness.fresh || !usableStatus) {
          stale.push(timeframe);
        }
      }

      acc[style] = {
        ready: missing.length === 0 && stale.length === 0,
        missing,
        stale,
      };
      return acc;
    },
    {} as Record<Style, { ready: boolean; missing: Timeframe[]; stale: Timeframe[] }>
  );
}
