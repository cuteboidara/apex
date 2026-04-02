import type { Candle, FairValueGap } from "@/src/smc/types";

function minGapSize(candles: Candle[]): number {
  const last = candles.at(-1)?.close ?? 1;
  return Math.max(last * 0.001, Number.EPSILON);
}

export function detectFairValueGaps(candles: Candle[], count = 100): FairValueGap[] {
  if (candles.length < 3) {
    return [];
  }

  const recent = candles.slice(-count);
  const minimumGap = minGapSize(recent);
  const fairValueGaps: FairValueGap[] = [];

  for (let index = 0; index < recent.length - 2; index += 1) {
    const c0 = recent[index];
    const c1 = recent[index + 1];
    const c2 = recent[index + 2];
    if (!c0 || !c1 || !c2) {
      continue;
    }

    if (c2.low > c0.high) {
      const size = c2.low - c0.high;
      if (size >= minimumGap) {
        const lower = c0.high;
        const upper = c2.low;
        const futureCandles = recent.slice(index + 3);
        const lowestTrade = futureCandles.reduce((min, candle) => Math.min(min, candle.low), upper);
        const filled = futureCandles.some(candle => candle.low <= lower);
        const partiallyFilled = !filled && futureCandles.some(candle => candle.low < upper);
        const fillPercent = filled
          ? 100
          : partiallyFilled
            ? Math.max(0, Math.min(99, Math.round(((upper - Math.max(lowestTrade, lower)) / size) * 100)))
            : 0;

        fairValueGaps.push({
          type: "bullish",
          upper,
          lower,
          midpoint: (upper + lower) / 2,
          size,
          time: c1.time,
          filled,
          partiallyFilled,
          fillPercent,
        });
      }
    }

    if (c0.low > c2.high) {
      const size = c0.low - c2.high;
      if (size >= minimumGap) {
        const lower = c2.high;
        const upper = c0.low;
        const futureCandles = recent.slice(index + 3);
        const highestTrade = futureCandles.reduce((max, candle) => Math.max(max, candle.high), lower);
        const filled = futureCandles.some(candle => candle.high >= upper);
        const partiallyFilled = !filled && futureCandles.some(candle => candle.high > lower);
        const fillPercent = filled
          ? 100
          : partiallyFilled
            ? Math.max(0, Math.min(99, Math.round(((Math.min(highestTrade, upper) - lower) / size) * 100)))
            : 0;

        fairValueGaps.push({
          type: "bearish",
          upper,
          lower,
          midpoint: (upper + lower) / 2,
          size,
          time: c1.time,
          filled,
          partiallyFilled,
          fillPercent,
        });
      }
    }
  }

  return fairValueGaps
    .filter(gap => !gap.filled)
    .sort((left, right) => right.time - left.time)
    .slice(0, 5);
}

export function scoreFVG(
  fairValueGaps: FairValueGap[],
  direction: "buy" | "sell" | "neutral",
  livePrice: number | null,
): number {
  if (!livePrice || direction === "neutral" || fairValueGaps.length === 0) {
    return 0;
  }

  const targetType = direction === "buy" ? "bullish" : "bearish";
  const relevant = fairValueGaps.filter(gap => gap.type === targetType);
  if (relevant.length === 0) {
    return 0;
  }

  for (const gap of relevant) {
    if (livePrice >= gap.lower && livePrice <= gap.upper) {
      return gap.partiallyFilled ? 6 : 10;
    }
    const nearby = direction === "buy"
      ? livePrice >= gap.lower - gap.size && livePrice < gap.lower
      : livePrice <= gap.upper + gap.size && livePrice > gap.upper;
    if (nearby) {
      return 5;
    }
  }

  return 2;
}
