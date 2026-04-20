import type { CandleGateResult, ScalpCandle } from "@/src/scalp/types/scalpTypes";

type Pattern = {
  name: string;
  quality: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function checkCandlePattern(direction: "long" | "short", candles15m: ScalpCandle[]): CandleGateResult {
  if (candles15m.length < 3) {
    return { pass: false, score: 0, reasoning: "Not enough candles" };
  }

  const last = candles15m[candles15m.length - 1];
  const prev = candles15m[candles15m.length - 2];

  const patterns: Pattern[] = [];

  const body = Math.abs(last.close - last.open);
  const range = Math.max(0.0000001, last.high - last.low);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;

  if (direction === "long") {
    const engulfing = last.close > last.open
      && prev.close < prev.open
      && last.close > prev.open
      && last.open < prev.close;
    if (engulfing) patterns.push({ name: "bullish_engulfing", quality: 88 });

    if (lowerWick > body * 2 && last.close > last.open) {
      patterns.push({ name: "hammer", quality: clamp((lowerWick / range) * 100, 50, 82) });
    }

    const closePos = (last.close - last.low) / range;
    if (closePos > 0.75 && last.close > last.open) {
      patterns.push({ name: "strong_bullish_close", quality: clamp(closePos * 100, 60, 90) });
    }
  } else {
    const engulfing = last.close < last.open
      && prev.close > prev.open
      && last.open > prev.close
      && last.close < prev.open;
    if (engulfing) patterns.push({ name: "bearish_engulfing", quality: 88 });

    if (upperWick > body * 2 && last.close < last.open) {
      patterns.push({ name: "shooting_star", quality: clamp((upperWick / range) * 100, 50, 82) });
    }

    const closePos = (last.high - last.close) / range;
    if (closePos > 0.75 && last.close < last.open) {
      patterns.push({ name: "strong_bearish_close", quality: clamp(closePos * 100, 60, 90) });
    }
  }

  const best = patterns.sort((a, b) => b.quality - a.quality)[0];
  if (!best) {
    return { pass: false, score: 0, reasoning: "No qualifying candle pattern" };
  }

  const score = best.quality >= 85 ? 25 : best.quality >= 70 ? 20 : best.quality >= 50 ? 14 : 7;

  return {
    pass: best.quality >= 50,
    score,
    pattern: best.name,
    quality: best.quality,
    reasoning: `${best.name} (${Math.round(best.quality)}%)`,
  };
}
