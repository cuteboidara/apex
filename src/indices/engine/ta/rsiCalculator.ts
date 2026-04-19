// src/indices/engine/ta/rsiCalculator.ts
// RSI(14) with overbought/oversold scoring

import type { Candle, RSIData } from '@/src/indices/types';

const RSI_PERIOD = 14;

export function calcRSI(candles: Candle[], period = RSI_PERIOD): number {
  if (candles.length < period + 1) return 50;

  const closes = candles.map(c => c.close);
  const changes = closes.slice(1).map((close, i) => close - closes[i]!);

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < period; i++) {
    const change = changes[i]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smooth with Wilder's method
  for (let i = period; i < changes.length; i++) {
    const change = changes[i]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function buildRSIData(candles: Candle[], direction: 'bullish' | 'bearish'): RSIData {
  const value = calcRSI(candles);

  const state: RSIData['state'] =
    value > 70 ? 'overbought' :
    value < 30 ? 'oversold' : 'neutral';

  // Points: 0-7
  let quality = 0;
  if (direction === 'bullish') {
    if (value < 30) quality = 7;           // extreme oversold = strong long confirmation
    else if (value < 45) quality = 4;      // favorable zone
    else if (value < 55) quality = 2;      // neutral, not conflicting
    else quality = 0;                      // overbought on long = no points
  } else {
    if (value > 70) quality = 7;           // extreme overbought = strong short confirmation
    else if (value > 55) quality = 4;      // favorable zone
    else if (value > 45) quality = 2;      // neutral
    else quality = 0;                      // oversold on short = no points
  }

  // Divergence detection (basic: RSI moving opposite to price)
  const divergence = detectDivergence(candles, value);

  return { value, state, divergence, quality };
}

function detectDivergence(candles: Candle[], currentRSI: number): RSIData['divergence'] {
  if (candles.length < 20) return undefined;

  const lookback = candles.slice(-20);
  const prices = lookback.map(c => c.close);
  const midRSI = calcRSI(lookback.slice(0, -5));

  const priceUp = prices.at(-1)! > prices[0]!;
  const rsiUp = currentRSI > midRSI;

  if (priceUp && !rsiUp) return 'bearish'; // price up, RSI down = bearish divergence
  if (!priceUp && rsiUp) return 'bullish'; // price down, RSI up = bullish divergence
  return undefined;
}
