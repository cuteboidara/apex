// src/indices/engine/quant/correlationMatrix.ts
// Compute pairwise Pearson correlation from daily returns

import type { Candle, CorrelationPair } from '@/src/indices/types';
import type { AssetSymbol } from '@/src/indices/data/fetchers/assetConfig';
import { getCache, setCache, CacheKeys, CacheTTL } from '@/src/indices/data/cache/cacheManager';

const LOOKBACK_DAYS = 30;

function dailyReturns(candles: Candle[]): number[] {
  const closes = candles.slice(-LOOKBACK_DAYS - 1).map(c => c.close);
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i]! - closes[i - 1]!) / closes[i - 1]!);
  }
  return returns;
}

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;

  const sliceA = a.slice(-n);
  const sliceB = b.slice(-n);

  const meanA = sliceA.reduce((s, v) => s + v, 0) / n;
  const meanB = sliceB.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  let varA = 0;
  let varB = 0;

  for (let i = 0; i < n; i++) {
    const da = sliceA[i]! - meanA;
    const db = sliceB[i]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }

  const denom = Math.sqrt(varA * varB);
  return denom === 0 ? 0 : cov / denom;
}

function strengthLabel(corr: number): CorrelationPair['strength'] {
  if (corr >= 0.7) return 'strong_positive';
  if (corr >= 0.4) return 'moderate_positive';
  if (corr <= -0.7) return 'strong_negative';
  if (corr <= -0.4) return 'moderate_negative';
  return 'weak';
}

export async function computeCorrelationMatrix(
  candleMap: Map<AssetSymbol, Candle[]>,
): Promise<CorrelationPair[]> {
  const cached = await getCache<CorrelationPair[]>(CacheKeys.correlations());
  if (cached) return cached;

  const assets = [...candleMap.keys()];
  const returnMap = new Map<AssetSymbol, number[]>();
  for (const [symbol, candles] of candleMap) {
    returnMap.set(symbol, dailyReturns(candles));
  }

  const pairs: CorrelationPair[] = [];
  for (let i = 0; i < assets.length; i++) {
    for (let j = i + 1; j < assets.length; j++) {
      const a = assets[i]!;
      const b = assets[j]!;
      const corr = pearsonCorrelation(returnMap.get(a) ?? [], returnMap.get(b) ?? []);
      pairs.push({ asset1: a, asset2: b, correlation: corr, strength: strengthLabel(corr) });
    }
  }

  await setCache(CacheKeys.correlations(), pairs, CacheTTL.correlations);
  return pairs;
}

export function getCorrelation(
  pairs: CorrelationPair[],
  a: string,
  b: string,
): number {
  const pair = pairs.find(
    p => (p.asset1 === a && p.asset2 === b) || (p.asset1 === b && p.asset2 === a),
  );
  return pair?.correlation ?? 0;
}

export function correlationBonus(
  assetId: string,
  direction: 'long' | 'short',
  pairs: CorrelationPair[],
  signalDirections: Map<string, 'long' | 'short'>,
): number {
  let bonus = 0;
  for (const [otherAsset, otherDirection] of signalDirections) {
    if (otherAsset === assetId) continue;
    const corr = getCorrelation(pairs, assetId, otherAsset);
    const aligned = direction === otherDirection;

    // Same direction + positive correlation = confirmation
    if (aligned && corr > 0.4) {
      bonus += corr * 10; // 0-10 pts proportional to correlation strength
    }
    // Same direction + negative correlation = warning (reduce bonus)
    if (aligned && corr < -0.4) {
      bonus -= corr * 5;
    }
  }
  return Math.max(0, Math.min(10, bonus));
}
