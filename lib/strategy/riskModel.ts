/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import { calculateRiskRewardRatio } from "@/lib/riskModel";

export function scoreRiskReward(entry: number, stopLoss: number, takeProfit1: number): { ratio: number | null; score: number } {
  const ratio = calculateRiskRewardRatio(entry, stopLoss, takeProfit1);
  if (ratio == null) {
    return { ratio: null, score: 0 };
  }

  if (ratio >= 3) return { ratio, score: 10 };
  if (ratio >= 2.5) return { ratio, score: 8 };
  if (ratio >= 2) return { ratio, score: 6 };
  return { ratio, score: 0 };
}

