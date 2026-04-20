import type { ScalpCandle, TrendGateResult } from "@/src/scalp/types/scalpTypes";
import { ema } from "@/src/scalp/engine/gates/indicators";

type Trend = "bullish" | "bearish" | "neutral";

function trendFromCandles1h(candles1h: ScalpCandle[]): Trend {
  if (candles1h.length < 25) return "neutral";
  const closes = candles1h.map(c => c.close);
  const ema21 = ema(closes, 21);
  const current = closes[closes.length - 1];
  if (current > ema21) return "bullish";
  if (current < ema21) return "bearish";
  return "neutral";
}

function trendFromCandles4h(candles4h: ScalpCandle[]): Trend {
  if (candles4h.length < 210) return "neutral";

  const closes = candles4h.map(c => c.close);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const current = closes[closes.length - 1];

  if (current > ema21 && ema50 > ema200) return "bullish";
  if (current < ema21 && ema50 < ema200) return "bearish";
  return "neutral";
}

export function checkTrendAlignment(candles1h: ScalpCandle[], candles4h: ScalpCandle[]): TrendGateResult {
  const trend1h = trendFromCandles1h(candles1h);
  const trend4h = trendFromCandles4h(candles4h);

  const aligned = trend1h === trend4h && trend1h !== "neutral";
  const score = aligned ? 20 : (trend4h !== "neutral" && trend1h === "neutral" ? 10 : 0);

  return {
    pass: aligned,
    score,
    alignedDirection: aligned ? (trend1h === "bullish" ? "long" : "short") : null,
    trend1h,
    trend4h,
    reasoning: aligned ? `HTF aligned ${trend1h}` : `HTF conflict (${trend1h} vs ${trend4h})`,
  };
}
