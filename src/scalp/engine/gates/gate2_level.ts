import type { LevelGateResult, ScalpCandle } from "@/src/scalp/types/scalpTypes";
import { calculateDailyPivots } from "@/src/scalp/engine/levels/pivotCalculator";
import { detectSimpleOrderBlocks } from "@/src/scalp/engine/levels/orderBlockDetector";
import { detectSimpleFvgs } from "@/src/scalp/engine/levels/fvgDetector";

type Level = {
  type: string;
  price: number;
  weight: number;
};

function buildRoundLevel(price: number, pipSize: number): number {
  const step = pipSize * 50;
  if (step <= 0) return price;
  return Math.round(price / step) * step;
}

export function checkKeyLevel(
  direction: "long" | "short",
  currentPrice: number,
  candles15m: ScalpCandle[],
  candles1h: ScalpCandle[],
  candlesDaily: ScalpCandle[],
  pipSize: number,
): LevelGateResult {
  if (candlesDaily.length < 2 || candles15m.length < 5 || candles1h.length < 12) {
    return { pass: false, score: 0, reasoning: "Insufficient candles for level validation" };
  }

  const maxDistance = pipSize * 10;
  const levels: Level[] = [];

  const pivots = calculateDailyPivots(candlesDaily);
  if (pivots) {
    levels.push(
      { type: "pivot_pp", price: pivots.pp, weight: 20 },
      { type: "pivot_r1", price: pivots.r1, weight: 18 },
      { type: "pivot_s1", price: pivots.s1, weight: 18 },
    );
  }

  const prevDay = candlesDaily[candlesDaily.length - 2];
  levels.push(
    { type: "prev_day_high", price: prevDay.high, weight: 18 },
    { type: "prev_day_low", price: prevDay.low, weight: 18 },
    { type: "round_number", price: buildRoundLevel(currentPrice, pipSize), weight: 14 },
  );

  const ob = detectSimpleOrderBlocks(candles1h).slice(-3);
  for (const block of ob) {
    levels.push({ type: `order_block_${block.type}`, price: block.price, weight: 16 });
  }

  const fvgs = detectSimpleFvgs(candles15m).slice(-3);
  for (const fvg of fvgs) {
    levels.push({ type: `fvg_${fvg.type}`, price: fvg.price, weight: 14 });
  }

  let best: Level | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const level of levels) {
    const distance = Math.abs(currentPrice - level.price);
    const validLocation = direction === "long"
      ? level.price <= currentPrice + (pipSize * 2)
      : level.price >= currentPrice - (pipSize * 2);

    if (!validLocation || distance > maxDistance) continue;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = level;
    }
  }

  if (!best) {
    return { pass: false, score: 0, reasoning: "No key level within 10 pips" };
  }

  const proximityScore = Math.max(0, 1 - (bestDistance / maxDistance));
  const score = Math.max(1, Math.round(best.weight * proximityScore));

  return {
    pass: true,
    score,
    levelType: best.type,
    levelPrice: best.price,
    reasoning: `At ${best.type} (${best.price.toFixed(5)})`,
  };
}
