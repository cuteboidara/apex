import type { SniperCandle } from "@/src/sniper/types/sniperTypes";

export function calculateRejectionStrength(
  candle: SniperCandle,
  direction: "bullish" | "bearish",
): number {
  const range = candle.high - candle.low;
  if (range <= 0) return 0;

  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  if (direction === "bullish") {
    const wickRatio = lowerWick / range;
    const closePosition = (candle.close - candle.low) / range;
    return Math.max(0, Math.min(100, Math.round((wickRatio * 50) + (closePosition * 50))));
  }

  const wickRatio = upperWick / range;
  const closePosition = (candle.high - candle.close) / range;
  return Math.max(0, Math.min(100, Math.round((wickRatio * 50) + (closePosition * 50))));
}

