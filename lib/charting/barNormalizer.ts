/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import type { MarketStatus, Timeframe } from "@/lib/marketData/types";

export type TradingViewBar = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

export type CandleApiResponse = {
  symbol: string;
  timeframe: Timeframe;
  candles: Array<{
    timestamp: number;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }>;
  selectedProvider: string | null;
  provider: string | null;
  fallbackUsed: boolean;
  freshnessMs: number | null;
  marketStatus: MarketStatus;
  stale: boolean;
  reason: string | null;
  circuitState: string | null;
  fromCache?: boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeVolume(value: number | null | undefined) {
  return isFiniteNumber(value) ? value : undefined;
}

function isValidBar(bar: TradingViewBar) {
  if (!isFiniteNumber(bar.time) || bar.time <= 0) return false;
  if (!isFiniteNumber(bar.open) || !isFiniteNumber(bar.high) || !isFiniteNumber(bar.low) || !isFiniteNumber(bar.close)) {
    return false;
  }

  if (bar.high < bar.low) return false;
  if (bar.high < Math.max(bar.open, bar.close)) return false;
  if (bar.low > Math.min(bar.open, bar.close)) return false;
  return true;
}

export function normalizeTradingViewBars(response: CandleApiResponse): TradingViewBar[] {
  const byTime = new Map<number, TradingViewBar>();

  for (const candle of response.candles) {
    if (
      !isFiniteNumber(candle.timestamp) ||
      !isFiniteNumber(candle.open) ||
      !isFiniteNumber(candle.high) ||
      !isFiniteNumber(candle.low) ||
      !isFiniteNumber(candle.close)
    ) {
      continue;
    }

    const bar: TradingViewBar = {
      time: candle.timestamp > 1_000_000_000_000 ? candle.timestamp : candle.timestamp * 1000,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: normalizeVolume(candle.volume),
    };

    if (!isValidBar(bar)) {
      continue;
    }

    byTime.set(bar.time, bar);
  }

  return [...byTime.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, bar]) => bar);
}

export function tradingViewBarKey(bar: TradingViewBar | null | undefined) {
  if (!bar) return null;
  return [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume ?? ""].join(":");
}

