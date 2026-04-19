// src/indices/engine/smc/liquidityDetector.ts
// Detect liquidity sweeps: price breaks a swing level then reverses

import type { Candle, SwingPoint } from '@/src/indices/types';
import { detectSwings } from './swingDetector';

export interface LiquiditySweep {
  side: 'buyside' | 'sellside';
  sweptLevel: number;        // the swing level that was swept
  sweepCandle: Candle;       // candle that broke the level
  reversalCandle: Candle;    // candle that closed back inside
  reversed: boolean;
  reversalStrength: 'strong' | 'moderate' | 'weak';
  candlesAgo: number;
}

export function detectLiquiditySweeps(candles: Candle[], lookback = 5): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  const { highs, lows } = detectSwings(candles, lookback);

  // Check buyside sweeps: price breaks above swing high then reverses
  for (const swingHigh of highs) {
    for (let i = swingHigh.index + 1; i < candles.length - 1; i++) {
      const sweepCandle = candles[i]!;
      const nextCandle = candles[i + 1];
      if (!nextCandle) continue;

      // Price broke above swing high
      if (sweepCandle.high > swingHigh.price) {
        // Check if next candle reversed (closed below the swing high)
        const reversed = nextCandle.close < swingHigh.price;
        const candlesAgo = candles.length - 1 - i;

        if (candlesAgo > 20) break; // only care about recent sweeps

        const strength = computeReversalStrength(sweepCandle, nextCandle, swingHigh.price, 'buyside');
        sweeps.push({
          side: 'buyside',
          sweptLevel: swingHigh.price,
          sweepCandle,
          reversalCandle: nextCandle,
          reversed,
          reversalStrength: strength,
          candlesAgo,
        });
        break; // only capture first sweep of this swing high
      }
    }
  }

  // Check sellside sweeps: price breaks below swing low then reverses
  for (const swingLow of lows) {
    for (let i = swingLow.index + 1; i < candles.length - 1; i++) {
      const sweepCandle = candles[i]!;
      const nextCandle = candles[i + 1];
      if (!nextCandle) continue;

      if (sweepCandle.low < swingLow.price) {
        const reversed = nextCandle.close > swingLow.price;
        const candlesAgo = candles.length - 1 - i;

        if (candlesAgo > 20) break;

        const strength = computeReversalStrength(sweepCandle, nextCandle, swingLow.price, 'sellside');
        sweeps.push({
          side: 'sellside',
          sweptLevel: swingLow.price,
          sweepCandle,
          reversalCandle: nextCandle,
          reversed,
          reversalStrength: strength,
          candlesAgo,
        });
        break;
      }
    }
  }

  // Most recent first
  return sweeps.sort((a, b) => a.candlesAgo - b.candlesAgo);
}

function computeReversalStrength(
  sweepCandle: Candle,
  reversalCandle: Candle,
  level: number,
  side: 'buyside' | 'sellside',
): 'strong' | 'moderate' | 'weak' {
  if (side === 'buyside') {
    // Strong reversal: large bearish candle after sweep
    const bodySize = Math.abs(reversalCandle.close - reversalCandle.open);
    const totalRange = reversalCandle.high - reversalCandle.low;
    const bearishBody = reversalCandle.close < reversalCandle.open;

    if (bearishBody && bodySize > totalRange * 0.6 && reversalCandle.close < level) return 'strong';
    if (bearishBody && reversalCandle.close < level) return 'moderate';
    return 'weak';
  } else {
    const bodySize = Math.abs(reversalCandle.close - reversalCandle.open);
    const totalRange = reversalCandle.high - reversalCandle.low;
    const bullishBody = reversalCandle.close > reversalCandle.open;

    if (bullishBody && bodySize > totalRange * 0.6 && reversalCandle.close > level) return 'strong';
    if (bullishBody && reversalCandle.close > level) return 'moderate';
    return 'weak';
  }
}

export function getMostRecentSweep(candles: Candle[], lookback = 5): LiquiditySweep | null {
  const sweeps = detectLiquiditySweeps(candles, lookback);
  return sweeps.find(s => s.reversed) ?? sweeps[0] ?? null;
}

export function hasRecentConfirmedSweep(candles: Candle[], direction: 'bullish' | 'bearish', lookback = 5): boolean {
  const sweeps = detectLiquiditySweeps(candles, lookback);
  const recent = sweeps.filter(s => s.candlesAgo <= 10 && s.reversed);

  if (direction === 'bullish') {
    return recent.some(s => s.side === 'sellside');
  }
  return recent.some(s => s.side === 'buyside');
}
