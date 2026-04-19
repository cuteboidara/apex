// src/indices/engine/ta/fibonacciCalculator.ts
// Fibonacci retracement + extension levels from swing high/low

import type { Candle, FibonacciLevel } from '@/src/indices/types';
import { getLastSwingHigh, getLastSwingLow } from '../smc/swingDetector';

const FIB_RATIOS = [0.236, 0.382, 0.5, 0.618, 0.705, 0.786];
const FIB_EXTENSIONS = [1.272, 1.618, 2.0, 2.618];

export function calcFibLevels(candles: Candle[], direction: 'bullish' | 'bearish'): FibonacciLevel[] {
  const swingHigh = getLastSwingHigh(candles);
  const swingLow = getLastSwingLow(candles);

  if (!swingHigh || !swingLow) return [];

  const high = swingHigh.price;
  const low = swingLow.price;
  const range = high - low;

  const levels: FibonacciLevel[] = [];

  if (direction === 'bullish') {
    // Retracements from high to low (price bouncing from low)
    for (const ratio of FIB_RATIOS) {
      levels.push({
        ratio,
        price: high - range * ratio,
        type: 'retracement',
      });
    }
    // Extensions above the high
    for (const ratio of FIB_EXTENSIONS) {
      levels.push({
        ratio,
        price: low + range * ratio,
        type: 'extension',
      });
    }
  } else {
    // Retracements from low to high (price bouncing from high)
    for (const ratio of FIB_RATIOS) {
      levels.push({
        ratio,
        price: low + range * ratio,
        type: 'retracement',
      });
    }
    // Extensions below the low
    for (const ratio of FIB_EXTENSIONS) {
      levels.push({
        ratio,
        price: high - range * ratio,
        type: 'extension',
      });
    }
  }

  return levels;
}

export function fibScore(
  entryPrice: number,
  tp1: number,
  tp2: number,
  fibLevels: FibonacciLevel[],
): number {
  let score = 0;
  const band = 0.005; // 0.5% proximity
  const near = (price: number, level: number) => Math.abs(price - level) / level < band;

  const retracements = fibLevels.filter(f => f.type === 'retracement');
  const extensions = fibLevels.filter(f => f.type === 'extension');

  // Entry at key fib level (natural bounce): +5 pts
  if (retracements.some(f => near(entryPrice, f.price))) score += 5;

  // TP1/TP2 at extension levels: +2 pts each
  if (extensions.some(f => near(tp1, f.price))) score += 2;
  if (extensions.some(f => near(tp2, f.price))) score += 2;

  return Math.min(5, score);
}
