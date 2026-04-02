import type { EarningsEvent, PolygonCandle } from "@/src/assets/shared/PolygonDataPlant";

export type EarningsSetupType =
  | "pre_earnings_long"
  | "pre_earnings_short"
  | "post_earnings_gap_up"
  | "post_earnings_gap_down"
  | "none";

export interface EarningsContext {
  hasUpcomingEarnings: boolean;
  daysUntilEarnings: number | null;
  setupType: EarningsSetupType;
  confidenceBoost: number;
  note: string;
}

export function analyzeEarningsContext(
  symbol: string,
  candles: PolygonCandle[],
  earningsEvents: EarningsEvent[],
  trendDirection: "bullish" | "bearish" | "neutral",
): EarningsContext {
  const event = earningsEvents.find(candidate => candidate.symbol === symbol);
  if (!event) {
    return {
      hasUpcomingEarnings: false,
      daysUntilEarnings: null,
      setupType: "none",
      confidenceBoost: 1,
      note: "No earnings data available",
    };
  }

  const days = event.daysUntil;
  if (days > 0 && days <= 5) {
    const setupType = trendDirection === "bullish"
      ? "pre_earnings_long"
      : trendDirection === "bearish"
        ? "pre_earnings_short"
        : "none";
    return {
      hasUpcomingEarnings: true,
      daysUntilEarnings: days,
      setupType,
      confidenceBoost: 1.25,
      note: `Earnings in ${days} day${days === 1 ? "" : "s"} - elevated setup probability`,
    };
  }

  if (days >= -2 && days <= 0 && candles.length >= 2) {
    const lastCandle = candles[candles.length - 1];
    const previousCandle = candles[candles.length - 2];
    const gapPercent = previousCandle.close === 0
      ? 0
      : ((lastCandle.open - previousCandle.close) / previousCandle.close) * 100;

    if (Math.abs(gapPercent) >= 3) {
      const setupType = gapPercent > 0 ? "post_earnings_gap_up" : "post_earnings_gap_down";
      return {
        hasUpcomingEarnings: false,
        daysUntilEarnings: days,
        setupType,
        confidenceBoost: 1.35,
        note: `Post-earnings gap ${gapPercent > 0 ? "up" : "down"} ${Math.abs(gapPercent).toFixed(1)}% - continuation setup`,
      };
    }
  }

  return {
    hasUpcomingEarnings: days > 0 && days <= 14,
    daysUntilEarnings: days,
    setupType: "none",
    confidenceBoost: 1,
    note: days > 0 ? `Earnings in ${days} days` : "Post-earnings period",
  };
}
