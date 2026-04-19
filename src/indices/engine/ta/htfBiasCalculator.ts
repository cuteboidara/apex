// src/indices/engine/ta/htfBiasCalculator.ts
// Calculate higher timeframe trend bias from weekly + daily candles

import type { Candle, HTFBias } from '@/src/indices/types';

const SMA_PERIOD = 20;
const NEUTRAL_BAND_PCT = 0.02; // ±2% of SMA = neutral zone

function computeSMA(closes: number[], period: number): number {
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function calcHTFBias(
  dailyCandles: Candle[],
  weeklyCandles: Candle[],
): HTFBias {
  // ─── Daily ───────────────────────────────────────────────────────────────
  const dailyCloses = dailyCandles.map(c => c.close);
  const dailyPrice = dailyCloses.at(-1) ?? 0;
  const dailySma = computeSMA(dailyCloses, SMA_PERIOD);
  const dailyDeviation = (dailyPrice - dailySma) / dailySma;

  const dailyTrend =
    dailyDeviation > NEUTRAL_BAND_PCT ? 'bullish' :
    dailyDeviation < -NEUTRAL_BAND_PCT ? 'bearish' : 'neutral';

  // ─── Weekly ──────────────────────────────────────────────────────────────
  const weeklyCloses = weeklyCandles.map(c => c.close);
  const weeklyPrice = weeklyCloses.at(-1) ?? 0;
  const weeklySma = computeSMA(weeklyCloses, SMA_PERIOD);
  const weeklyDeviation = (weeklyPrice - weeklySma) / weeklySma;

  const weeklyTrend =
    weeklyDeviation > NEUTRAL_BAND_PCT ? 'bullish' :
    weeklyDeviation < -NEUTRAL_BAND_PCT ? 'bearish' : 'neutral';

  // ─── Combined bias ────────────────────────────────────────────────────────
  let combined: HTFBias['combined'];
  if (weeklyTrend === 'bullish' && dailyTrend === 'bullish') combined = 'strong_bullish';
  else if (weeklyTrend === 'bearish' && dailyTrend === 'bearish') combined = 'strong_bearish';
  else if (weeklyTrend === 'bullish' || dailyTrend === 'bullish') combined = 'bullish';
  else if (weeklyTrend === 'bearish' || dailyTrend === 'bearish') combined = 'bearish';
  else combined = 'neutral';

  // ─── Points (0-10) ────────────────────────────────────────────────────────
  const alignment =
    combined === 'strong_bullish' || combined === 'strong_bearish' ? 10 :
    combined === 'bullish' || combined === 'bearish' ? 6 : 2;

  return {
    weekly: {
      trend: weeklyTrend,
      price: weeklyPrice,
      sma: weeklySma,
      strength: Math.max(-1, Math.min(1, weeklyDeviation * 10)),
    },
    daily: {
      trend: dailyTrend,
      price: dailyPrice,
      sma: dailySma,
      strength: Math.max(-1, Math.min(1, dailyDeviation * 10)),
    },
    combined,
    alignment,
  };
}
