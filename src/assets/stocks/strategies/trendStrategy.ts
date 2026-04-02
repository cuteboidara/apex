import type { PolygonCandle } from "@/src/assets/shared/PolygonDataPlant";

export interface TrendAnalysis {
  direction: "bullish" | "bearish" | "neutral";
  strength: "strong" | "moderate" | "weak";
  ema20: number;
  ema50: number;
  ema200: number;
  priceAboveEma20: boolean;
  priceAboveEma50: boolean;
  priceAboveEma200: boolean;
  momentum: number;
  trendScore: number;
}

function calculateEMA(candles: PolygonCandle[], period: number): number {
  if (candles.length === 0) {
    return 0;
  }
  if (candles.length < period) {
    return candles[candles.length - 1]?.close ?? 0;
  }

  const k = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  for (let index = period; index < candles.length; index += 1) {
    ema = candles[index].close * k + ema * (1 - k);
  }
  return ema;
}

export function analyzeTrend(candles: PolygonCandle[]): TrendAnalysis {
  if (candles.length < 20) {
    return {
      direction: "neutral",
      strength: "weak",
      ema20: 0,
      ema50: 0,
      ema200: 0,
      priceAboveEma20: false,
      priceAboveEma50: false,
      priceAboveEma200: false,
      momentum: 0,
      trendScore: 0,
    };
  }

  const lastPrice = candles[candles.length - 1].close;
  const ema20 = calculateEMA(candles, 20);
  const ema50 = calculateEMA(candles, 50);
  const ema200 = calculateEMA(candles, 100);
  const priceAboveEma20 = lastPrice > ema20;
  const priceAboveEma50 = lastPrice > ema50;
  const priceAboveEma200 = lastPrice > ema200;
  const tenAgo = candles[Math.max(0, candles.length - 10)]?.close ?? lastPrice;
  const momentum = tenAgo === 0 ? 0 : ((lastPrice - tenAgo) / tenAgo) * 100;

  let trendScore = 0;
  if (priceAboveEma20) trendScore += 20;
  if (priceAboveEma50) trendScore += 25;
  if (priceAboveEma200) trendScore += 30;
  if (ema20 > ema50) trendScore += 15;
  if (momentum > 0) {
    trendScore += Math.min(10, Math.abs(momentum) * 2);
  }

  const bullishScore = trendScore;
  const bearishScore = 100 - trendScore;
  const direction = bullishScore >= 60
    ? "bullish"
    : bearishScore >= 60
      ? "bearish"
      : "neutral";
  const spread = Math.abs(bullishScore - bearishScore);
  const strength = spread >= 40
    ? "strong"
    : spread >= 20
      ? "moderate"
      : "weak";

  return {
    direction,
    strength,
    ema20,
    ema50,
    ema200,
    priceAboveEma20,
    priceAboveEma50,
    priceAboveEma200,
    momentum,
    trendScore,
  };
}
