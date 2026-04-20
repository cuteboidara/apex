import type { LiquidityLevel, SniperCandle } from "@/src/sniper/types/sniperTypes";

function calculateStrength(
  candles: SniperCandle[],
  idx: number,
  type: "high" | "low",
): number {
  const level = type === "high" ? candles[idx].high : candles[idx].low;
  let respected = 0;

  for (let i = idx + 1; i < Math.min(idx + 10, candles.length); i += 1) {
    if (type === "high" && candles[i].high < level) respected += 1;
    if (type === "low" && candles[i].low > level) respected += 1;
  }

  if (respected >= 8) return 5;
  if (respected >= 6) return 4;
  if (respected >= 4) return 3;
  if (respected >= 2) return 2;
  return 1;
}

export function detectLiquidityLevels(
  candles: SniperCandle[],
  lookback = 5,
): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [];
  if (candles.length < lookback * 2 + 1) return levels;

  for (let i = lookback; i < candles.length - lookback; i += 1) {
    const current = candles[i];
    const window = candles.slice(i - lookback, i + lookback + 1);

    const isSwingHigh = window.every((row, idx) => idx === lookback || row.high <= current.high);
    const isSwingLow = window.every((row, idx) => idx === lookback || row.low >= current.low);

    if (isSwingHigh) {
      levels.push({
        type: "high",
        price: current.high,
        timestamp: current.timestamp,
        candleIndex: i,
        strength: calculateStrength(candles, i, "high"),
        swept: false,
      });
    }

    if (isSwingLow) {
      levels.push({
        type: "low",
        price: current.low,
        timestamp: current.timestamp,
        candleIndex: i,
        strength: calculateStrength(candles, i, "low"),
        swept: false,
      });
    }
  }

  return levels.filter(level => candles.length - level.candleIndex <= 40 && !level.swept);
}

