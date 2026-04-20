import type { MomentumGateResult, ScalpCandle } from "@/src/scalp/types/scalpTypes";
import { calculateMACD, calculateRSI, calculateStochRSI } from "@/src/scalp/engine/gates/indicators";

export function checkMomentum(direction: "long" | "short", candles15m: ScalpCandle[]): MomentumGateResult {
  const closes = candles15m.map(c => c.close);
  if (closes.length < 40) {
    return {
      pass: false,
      score: 0,
      confirmCount: 0,
      rsi: 50,
      macdHistogram: 0,
      stochRsi: 50,
      reasoning: "Insufficient candles for momentum checks",
    };
  }

  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const prevMacd = calculateMACD(closes.slice(0, -1));
  const stochRsi = calculateStochRSI(closes, 14, 14);

  const macdRising = macd.histogram >= prevMacd.histogram;
  const macdFalling = macd.histogram <= prevMacd.histogram;

  let confirmCount = 0;

  if (direction === "long") {
    if (rsi >= 30 && rsi <= 65) confirmCount += 1;
    if (macd.histogram > 0 || macdRising) confirmCount += 1;
    if (stochRsi > 20 && stochRsi < 80) confirmCount += 1;
  } else {
    if (rsi >= 35 && rsi <= 70) confirmCount += 1;
    if (macd.histogram < 0 || macdFalling) confirmCount += 1;
    if (stochRsi > 20 && stochRsi < 80) confirmCount += 1;
  }

  const pass = confirmCount >= 2;
  const score = confirmCount === 3 ? 20 : confirmCount === 2 ? 14 : 0;

  return {
    pass,
    score,
    confirmCount,
    rsi,
    macdHistogram: macd.histogram,
    stochRsi,
    reasoning: `${confirmCount}/3 confirmed`,
  };
}
