// src/indices/engine/amt/fairValueDetector.ts
// Calculate VWAP-based Fair Value Area for AMT analysis

import type { Candle } from '@/src/indices/types';
import type { FairValueArea } from '@/src/indices/types/amtTypes';

/**
 * Compute VWAP (Volume-Weighted Average Price) from candles.
 * Uses typical price = (high + low + close) / 3
 */
function computeVWAP(candles: Candle[]): number {
  let sumPV = 0;
  let sumV = 0;

  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    sumPV += typicalPrice * c.volume;
    sumV += c.volume;
  }

  if (sumV === 0) {
    // Fallback: simple average of typical prices
    const sum = candles.reduce((acc, c) => acc + (c.high + c.low + c.close) / 3, 0);
    return sum / candles.length;
  }

  return sumPV / sumV;
}

/**
 * Compute population standard deviation of close prices around VWAP.
 * Used to define the fair value band (±1σ).
 */
function computeStdDev(candles: Candle[], mean: number): number {
  if (candles.length < 2) return 0;

  const sumSq = candles.reduce((acc, c) => {
    const diff = c.close - mean;
    return acc + diff * diff;
  }, 0);

  return Math.sqrt(sumSq / candles.length);
}

/**
 * Measure how many candles have their close inside the FVA band.
 * Returns 0–100 (percentage).
 */
function computeFVAStrength(candles: Candle[], upper: number, lower: number): number {
  if (candles.length === 0) return 0;

  const inside = candles.filter(c => c.close >= lower && c.close <= upper).length;
  return Math.round((inside / candles.length) * 100);
}

/**
 * Detect the Fair Value Area from a set of candles.
 *
 * FVA = VWAP ± 1 standard deviation of closes.
 * Strength = % of candles whose close is inside FVA.
 *
 * @param candles  Array of candles (typically the session / 4H window)
 * @returns        FairValueArea object
 */
export function detectFairValueArea(candles: Candle[]): FairValueArea {
  if (candles.length === 0) {
    throw new Error('[FVA] Cannot compute fair value area from empty candle array');
  }

  const vwap = computeVWAP(candles);
  const stdDev = computeStdDev(candles, vwap);

  const upper = vwap + stdDev;
  const lower = vwap - stdDev;
  const bandWidth = upper - lower;
  const bandWidthPct = vwap > 0 ? bandWidth / vwap : 0;

  const strength = computeFVAStrength(candles, upper, lower);

  return {
    center: vwap,
    upper,
    lower,
    strength,
    bandWidth,
    bandWidthPct,
    lastUpdated: new Date(),
  };
}

/**
 * Classify price position relative to the FVA.
 */
export function classifyPriceVsFVA(
  price: number,
  fva: FairValueArea,
): 'below' | 'inside' | 'above' {
  if (price > fva.upper) return 'above';
  if (price < fva.lower) return 'below';
  return 'inside';
}

/**
 * Determine if the FVA band is narrow (price is tightly consolidated).
 * Tight FVA (< 0.3% of VWAP) = potential breakout setup.
 * Wide FVA (> 1.5% of VWAP) = noisy / trending session.
 */
export function classifyFVAWidth(fva: FairValueArea): 'tight' | 'normal' | 'wide' {
  const pct = fva.bandWidthPct * 100; // as percentage
  if (pct < 0.3) return 'tight';
  if (pct > 1.5) return 'wide';
  return 'normal';
}

/**
 * Check whether price has recently been rejected from FVA boundary.
 * Used to detect failed auction scenarios.
 *
 * @param recentCandles  Last N candles (e.g. last 5)
 * @param fva            Current FVA
 * @param direction      'long' = look for rejection of lower FVA bound
 *                       'short' = look for rejection of upper FVA bound
 */
export function detectFVARejection(
  recentCandles: Candle[],
  fva: FairValueArea,
  direction: 'long' | 'short',
): { rejected: boolean; rejectionStrength: number } {
  if (recentCandles.length === 0) {
    return { rejected: false, rejectionStrength: 0 };
  }

  const last = recentCandles[recentCandles.length - 1];
  const boundary = direction === 'long' ? fva.lower : fva.upper;
  const tolerance = fva.bandWidth * 0.1; // 10% of band as tolerance

  if (direction === 'long') {
    // Price dipped below or touched lower FVA and reversed
    const touchedLower = recentCandles.some(
      c => c.low <= boundary + tolerance,
    );
    const recovered = last.close > boundary;
    const rejected = touchedLower && recovered;

    if (!rejected) return { rejected: false, rejectionStrength: 0 };

    // Strength: how far close is above boundary relative to band width
    const rejectionStrength = Math.min(
      100,
      Math.round(((last.close - boundary) / fva.bandWidth) * 100),
    );
    return { rejected: true, rejectionStrength };
  } else {
    // Price poked above or touched upper FVA and reversed
    const touchedUpper = recentCandles.some(
      c => c.high >= boundary - tolerance,
    );
    const fell = last.close < boundary;
    const rejected = touchedUpper && fell;

    if (!rejected) return { rejected: false, rejectionStrength: 0 };

    const rejectionStrength = Math.min(
      100,
      Math.round(((boundary - last.close) / fva.bandWidth) * 100),
    );
    return { rejected: true, rejectionStrength };
  }
}
