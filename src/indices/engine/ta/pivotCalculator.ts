// src/indices/engine/ta/pivotCalculator.ts
// Classic pivot points from previous day's OHLC

import type { Candle, PivotLevels } from '@/src/indices/types';

export function calcPivotLevels(dailyCandles: Candle[]): PivotLevels {
  // Use previous completed day
  const prev = dailyCandles.at(-2) ?? dailyCandles.at(-1)!;

  const pivot = (prev.high + prev.low + prev.close) / 3;
  const r1 = 2 * pivot - prev.low;
  const s1 = 2 * pivot - prev.high;
  const r2 = pivot + (prev.high - prev.low);
  const s2 = pivot - (prev.high - prev.low);

  return { pivot, r1, r2, s1, s2 };
}

export function pivotProximityScore(
  entryPrice: number,
  pivots: PivotLevels,
  stopLoss: number,
  tp1: number,
  direction: 'bullish' | 'bearish',
): number {
  let score = 0;
  const band = 0.01; // 1% proximity threshold

  const levels = [pivots.pivot, pivots.r1, pivots.r2, pivots.s1, pivots.s2];
  const near = (price: number, level: number) => Math.abs(price - level) / level < band;

  // Entry near pivot: +8 pts
  if (levels.some(l => near(entryPrice, l))) score += 8;

  // SL at natural support/resistance: +5 pts
  const supportLevels = direction === 'bullish'
    ? [pivots.s1, pivots.s2, pivots.pivot]
    : [pivots.r1, pivots.r2, pivots.pivot];
  if (supportLevels.some(l => near(stopLoss, l))) score += 5;

  // TP1 at natural resistance/support: +3 pts
  const tpLevels = direction === 'bullish'
    ? [pivots.r1, pivots.r2, pivots.pivot]
    : [pivots.s1, pivots.s2, pivots.pivot];
  if (tpLevels.some(l => near(tp1, l))) score += 3;

  return Math.min(8, score);
}
