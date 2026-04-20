import type { LiquidityLevel, SniperCandle, SweepEvent } from "@/src/sniper/types/sniperTypes";
import { calculateRejectionStrength } from "@/src/sniper/engine/detectors/rejectionDetector";

export function detectSweeps(
  candles: SniperCandle[],
  levels: LiquidityLevel[],
): SweepEvent[] {
  const sweeps: SweepEvent[] = [];
  if (candles.length === 0) return sweeps;

  for (const level of levels) {
    for (let i = level.candleIndex + 1; i < candles.length; i += 1) {
      const candle = candles[i];

      if (level.type === "high" && candle.high > level.price) {
        const closeBack = candle.close < level.price;
        if (closeBack) {
          sweeps.push({
            level,
            sweepCandleIndex: i,
            sweepPrice: candle.high,
            rejectionStrength: calculateRejectionStrength(candle, "bearish"),
            closeBack,
            sweepType: "bearish",
          });
        }
        break;
      }

      if (level.type === "low" && candle.low < level.price) {
        const closeBack = candle.close > level.price;
        if (closeBack) {
          sweeps.push({
            level,
            sweepCandleIndex: i,
            sweepPrice: candle.low,
            rejectionStrength: calculateRejectionStrength(candle, "bullish"),
            closeBack,
            sweepType: "bullish",
          });
        }
        break;
      }
    }
  }

  return sweeps.filter(sweep => candles.length - sweep.sweepCandleIndex <= 5);
}

