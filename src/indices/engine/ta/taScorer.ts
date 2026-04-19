// src/indices/engine/ta/taScorer.ts
// Orchestrate TA analysis and produce TAConfluence with 0-30 score

import type { Candle, TAConfluence } from '@/src/indices/types';
import { calcHTFBias } from './htfBiasCalculator';
import { calcPivotLevels, pivotProximityScore } from './pivotCalculator';
import { buildRSIData } from './rsiCalculator';
import { buildVolumeProfile, volumeClusterScore } from './volumeProfiler';
import { calcFibLevels, fibScore } from './fibonacciCalculator';

export function runTAAnalysis(
  assetId: string,
  dailyCandles: Candle[],
  weeklyCandles: Candle[],
  entryPrice: number,
  stopLoss: number,
  tp1: number,
  tp2: number,
  direction: 'bullish' | 'bearish',
): TAConfluence {
  const now = new Date();

  // HTF Bias (0-10 pts)
  const htfBias = calcHTFBias(dailyCandles, weeklyCandles);
  const biasPoints = htfBias.alignment;

  // Pivot Levels (0-8 pts)
  const pivots = calcPivotLevels(dailyCandles);
  const pivotProximity = pivotProximityScore(entryPrice, pivots, stopLoss, tp1, direction);

  // RSI (0-7 pts)
  const rsi = buildRSIData(dailyCandles, direction);
  const rsiPoints = rsi.quality;

  // Volume Profile (0-5 pts)
  const volumeClusters = buildVolumeProfile(dailyCandles);
  const volumePoints = volumeClusterScore(entryPrice, stopLoss, tp1, volumeClusters, direction);

  // Fibonacci (0-5 pts)
  const fibonacciLevels = calcFibLevels(dailyCandles, direction);
  const fibPoints = fibScore(entryPrice, tp1, tp2, fibonacciLevels);

  const taScore = Math.min(30, biasPoints + pivotProximity + rsiPoints + volumePoints + fibPoints);

  return {
    assetId,
    timestamp: now,
    htfBias,
    biasPoints,
    pivots,
    pivotProximity,
    rsi,
    rsiPoints,
    volumeClusters: volumeClusters.slice(0, 10), // top 10 clusters
    volumePoints,
    fibonacciLevels,
    fibPoints,
    taScore,
  };
}
