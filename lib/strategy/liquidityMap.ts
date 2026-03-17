import type { LiquidityAssessment, MarketSnapshot } from "@/lib/strategy/types";

export function mapLiquidity(snapshot: MarketSnapshot): LiquidityAssessment {
  if (
    snapshot.currentPrice == null ||
    snapshot.high14d == null ||
    snapshot.low14d == null ||
    snapshot.high14d <= snapshot.low14d
  ) {
    return {
      score: 0,
      sweepSide: "none",
      quality: "low",
      location: "mid",
      thesis: "Liquidity map unavailable because the structure range is incomplete.",
      levels: {
        previousDayHigh: null,
        previousDayLow: null,
        weeklyHigh: null,
        weeklyLow: null,
      },
    };
  }

  const range = snapshot.high14d - snapshot.low14d;
  const normalized = (snapshot.currentPrice - snapshot.low14d) / range;
  const previousDayHigh = snapshot.high14d - range * 0.12;
  const previousDayLow = snapshot.low14d + range * 0.12;
  const weeklyHigh = snapshot.high14d - range * 0.03;
  const weeklyLow = snapshot.low14d + range * 0.03;
  const nearHigh = normalized >= 0.78;
  const nearLow = normalized <= 0.22;
  const nearMid = normalized > 0.22 && normalized < 0.78;

  return {
    score: nearHigh || nearLow ? 20 : nearMid ? 10 : 5,
    sweepSide: nearHigh ? "buyside" : nearLow ? "sellside" : "none",
    quality: nearHigh || nearLow ? "high" : nearMid ? "medium" : "low",
    location: nearLow ? "discount" : nearHigh ? "premium" : "mid",
    thesis: nearHigh
      ? "Price is pressing into buyside liquidity near equal/session highs."
      : nearLow
        ? "Price is pressing into sellside liquidity near equal/session lows."
        : "Price is rotating inside the range with weaker liquidity asymmetry.",
    levels: {
      previousDayHigh,
      previousDayLow,
      weeklyHigh,
      weeklyLow,
    },
  };
}
