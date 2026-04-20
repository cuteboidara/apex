import type { SniperCandle, StructureSnapshot } from "@/src/sniper/types/sniperTypes";

function averageClose(candles: SniperCandle[], period: number): number | null {
  if (candles.length < period) return null;
  const slice = candles.slice(-period);
  return slice.reduce((sum, candle) => sum + candle.close, 0) / period;
}

export function findNearestResistance(candles: SniperCandle[], currentPrice: number): number {
  const highs = candles
    .slice(-30)
    .map(candle => candle.high)
    .filter(high => high > currentPrice)
    .sort((a, b) => a - b);

  return highs[0] ?? (currentPrice * 1.003);
}

export function findNearestSupport(candles: SniperCandle[], currentPrice: number): number {
  const lows = candles
    .slice(-30)
    .map(candle => candle.low)
    .filter(low => low < currentPrice)
    .sort((a, b) => b - a);

  return lows[0] ?? (currentPrice * 0.997);
}

export function detectStructure(candles15m: SniperCandle[], candles1h: SniperCandle[]): StructureSnapshot {
  const current = candles1h.at(-1)?.close ?? candles15m.at(-1)?.close ?? 0;
  const sma20 = averageClose(candles1h, 20);

  const trend = sma20 == null
    ? "neutral"
    : current > sma20
      ? "up"
      : current < sma20
        ? "down"
        : "neutral";

  return {
    trend,
    nearestResistance: findNearestResistance(candles15m, current),
    nearestSupport: findNearestSupport(candles15m, current),
  };
}

