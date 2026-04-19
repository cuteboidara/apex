// src/indices/engine/smc/fvgDetector.ts
// Detect Fair Value Gaps (price imbalances between 3-candle sequences)

import type { Candle, FairValueGap } from '@/src/indices/types';

export function detectFVGs(assetId: string, candles: Candle[]): FairValueGap[] {
  const fvgs: FairValueGap[] = [];

  for (let i = 1; i < candles.length - 1; i++) {
    const prev = candles[i - 1]!;
    const curr = candles[i]!;
    const next = candles[i + 1]!;

    // Bullish FVG: gap between top of prev candle and bottom of next candle
    // prev.high < next.low means price jumped up leaving an unfilled gap
    if (prev.high < next.low) {
      const age = candles.length - 1 - i;
      fvgs.push({
        assetId,
        timestamp: curr.timestamp,
        type: 'bullish',
        gapHigh: next.low,
        gapLow: prev.high,
        daysOld: age,
        quality: scoreFVG({ age, gapSize: next.low - prev.high, referencePrice: curr.close }),
      });
    }

    // Bearish FVG: gap between bottom of prev candle and top of next candle
    // prev.low > next.high means price dropped leaving an unfilled gap
    if (prev.low > next.high) {
      const age = candles.length - 1 - i;
      fvgs.push({
        assetId,
        timestamp: curr.timestamp,
        type: 'bearish',
        gapHigh: prev.low,
        gapLow: next.high,
        daysOld: age,
        quality: scoreFVG({ age, gapSize: prev.low - next.high, referencePrice: curr.close }),
      });
    }
  }

  // Most recent first
  return fvgs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

function scoreFVG(input: { age: number; gapSize: number; referencePrice: number }): number {
  let score = 0;
  const gapPct = input.gapSize / input.referencePrice;

  // Freshness: 0-10 pts
  if (input.age < 5) score += 10;
  else if (input.age < 10) score += 8;
  else if (input.age < 20) score += 6;
  else score += 2;

  // Gap size significance (too small or too large is less meaningful)
  if (gapPct >= 0.001 && gapPct <= 0.005) score += 3;
  else if (gapPct > 0.005) score += 1;

  return Math.max(0, Math.min(10, score));
}

export function getRecentFVGs(
  assetId: string,
  candles: Candle[],
  direction: 'bullish' | 'bearish',
  count = 3,
): FairValueGap[] {
  const fvgs = detectFVGs(assetId, candles);
  return fvgs.filter(f => f.type === direction).slice(0, count);
}

// Check if a FVG has been partially or fully filled
export function checkFVGFill(fvg: FairValueGap, candles: Candle[]): number {
  let minGap = fvg.gapHigh - fvg.gapLow;
  const gapSize = minGap;

  for (const candle of candles) {
    if (candle.timestamp <= fvg.timestamp) continue;

    if (fvg.type === 'bullish') {
      // Price filling from above (bearish move into bullish gap)
      const fillDown = Math.max(0, fvg.gapHigh - Math.max(candle.low, fvg.gapLow));
      minGap = Math.min(minGap, gapSize - fillDown);
    } else {
      // Price filling from below (bullish move into bearish gap)
      const fillUp = Math.max(0, Math.min(candle.high, fvg.gapHigh) - fvg.gapLow);
      minGap = Math.min(minGap, gapSize - fillUp);
    }
  }

  return gapSize > 0 ? Math.max(0, Math.min(100, ((gapSize - minGap) / gapSize) * 100)) : 0;
}
