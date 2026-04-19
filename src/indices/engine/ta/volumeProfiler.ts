// src/indices/engine/ta/volumeProfiler.ts
// Volume profile: find high-volume nodes (support) and low-volume nodes (gaps)

import type { Candle, VolumeCluster } from '@/src/indices/types';

const BUCKET_COUNT = 30; // price levels to segment

export function buildVolumeProfile(candles: Candle[]): VolumeCluster[] {
  if (candles.length < 5) return [];

  const prices = candles.flatMap(c => [c.high, c.low]);
  const priceMin = Math.min(...prices);
  const priceMax = Math.max(...prices);
  const bucketSize = (priceMax - priceMin) / BUCKET_COUNT;

  if (bucketSize === 0) return [];

  // Accumulate volume per price bucket
  const buckets = new Map<number, number>();
  for (let i = 0; i < BUCKET_COUNT; i++) {
    buckets.set(i, 0);
  }

  for (const candle of candles) {
    // Distribute candle volume across its high-low range
    const candleRange = candle.high - candle.low;
    if (candleRange === 0) continue;

    const lowBucket = Math.floor((candle.low - priceMin) / bucketSize);
    const highBucket = Math.floor((candle.high - priceMin) / bucketSize);

    for (let b = lowBucket; b <= highBucket && b < BUCKET_COUNT; b++) {
      const bucketPct = 1 / Math.max(1, highBucket - lowBucket + 1);
      buckets.set(b, (buckets.get(b) ?? 0) + candle.volume * bucketPct);
    }
  }

  const volumes = [...buckets.values()];
  const maxVol = Math.max(...volumes);
  const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;

  const clusters: VolumeCluster[] = [];
  buckets.forEach((vol, idx) => {
    const price = priceMin + (idx + 0.5) * bucketSize;
    const strength: VolumeCluster['strength'] =
      vol > maxVol * 0.7 ? 'strong' :
      vol > avgVol ? 'medium' : 'weak';

    clusters.push({ price, volume: vol, strength });
  });

  return clusters.sort((a, b) => b.volume - a.volume);
}

export function volumeClusterScore(
  entryPrice: number,
  stopLoss: number,
  tp1: number,
  clusters: VolumeCluster[],
  direction: 'bullish' | 'bearish',
): number {
  let score = 0;
  const band = 0.005; // 0.5% proximity
  const near = (price: number, level: number) => Math.abs(price - level) / level < band;

  const strongClusters = clusters.filter(c => c.strength === 'strong');
  const weakClusters = clusters.filter(c => c.strength === 'weak');

  // Entry at strong volume cluster (support for long, resistance for short): +5 pts
  if (strongClusters.some(c => near(entryPrice, c.price))) score += 5;
  else if (clusters.filter(c => c.strength !== 'weak').some(c => near(entryPrice, c.price))) score += 3;

  // SL below/above a strong cluster: +3 pts (well supported stop)
  if (strongClusters.some(c => near(stopLoss, c.price))) score += 3;

  // TP1 at low-volume node (LVN) — price moves quickly through gaps: +2 pts
  if (weakClusters.some(c => near(tp1, c.price))) score += 2;

  return Math.min(5, score);
}
