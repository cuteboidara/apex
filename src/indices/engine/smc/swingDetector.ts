// src/indices/engine/smc/swingDetector.ts
// Identify swing highs and lows (structural turn points)

import type { Candle, SwingPoint } from '@/src/indices/types';

export function detectSwings(candles: Candle[], lookback = 5): { highs: SwingPoint[]; lows: SwingPoint[] } {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  // Need lookback candles on each side — start after the initial lookback period
  for (let i = lookback; i < candles.length - lookback; i++) {
    const candle = candles[i]!;
    const leftHighs = candles.slice(i - lookback, i).map(c => c.high);
    const rightHighs = candles.slice(i + 1, i + lookback + 1).map(c => c.high);
    const leftLows = candles.slice(i - lookback, i).map(c => c.low);
    const rightLows = candles.slice(i + 1, i + lookback + 1).map(c => c.low);

    const isSwingHigh =
      candle.high > Math.max(...leftHighs) &&
      candle.high > Math.max(...rightHighs);

    const isSwingLow =
      candle.low < Math.min(...leftLows) &&
      candle.low < Math.min(...rightLows);

    if (isSwingHigh) {
      highs.push({
        index: i,
        price: candle.high,
        type: 'high',
        timestamp: candle.timestamp,
        confirmed: true,
      });
    }

    if (isSwingLow) {
      lows.push({
        index: i,
        price: candle.low,
        type: 'low',
        timestamp: candle.timestamp,
        confirmed: true,
      });
    }
  }

  return { highs, lows };
}

export function getRecentSwingHigh(candles: Candle[], lookback = 5, count = 3): SwingPoint[] {
  const { highs } = detectSwings(candles, lookback);
  return highs.slice(-count);
}

export function getRecentSwingLow(candles: Candle[], lookback = 5, count = 3): SwingPoint[] {
  const { lows } = detectSwings(candles, lookback);
  return lows.slice(-count);
}

// Most recent confirmed swing high/low from the end of the candle array
export function getLastSwingHigh(candles: Candle[], lookback = 5): SwingPoint | null {
  const { highs } = detectSwings(candles, lookback);
  return highs.at(-1) ?? null;
}

export function getLastSwingLow(candles: Candle[], lookback = 5): SwingPoint | null {
  const { lows } = detectSwings(candles, lookback);
  return lows.at(-1) ?? null;
}
