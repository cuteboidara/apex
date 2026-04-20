import type { ScalpCandle } from "@/src/scalp/types/scalpTypes";

export type PivotLevels = {
  pp: number;
  r1: number;
  s1: number;
};

export function calculateDailyPivots(candlesDaily: ScalpCandle[]): PivotLevels | null {
  if (candlesDaily.length < 2) return null;
  const prevDay = candlesDaily[candlesDaily.length - 2];
  const pp = (prevDay.high + prevDay.low + prevDay.close) / 3;
  const r1 = 2 * pp - prevDay.low;
  const s1 = 2 * pp - prevDay.high;

  return { pp, r1, s1 };
}
