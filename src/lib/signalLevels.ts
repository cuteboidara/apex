import type { FeatureSnapshot } from "@/src/interfaces/contracts";
import { deriveTradePlan } from "@/src/lib/tradePlan";

export type SignalLevels = {
  entry: number;
  stop_loss: number;
  tp1: number;
  tp2: number | null;
  tp3: number | null;
  invalidation_level: number;
  risk_reward_ratio: number | null;
};

function roundPrice(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (Math.abs(value) >= 1000) {
    return Number(value.toFixed(2));
  }

  if (Math.abs(value) >= 1) {
    return Number(value.toFixed(4));
  }

  return Number(value.toFixed(6));
}

function calculateRiskReward(entry: number, stopLoss: number, target: number): number | null {
  const risk = Math.abs(entry - stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }

  return Number((Math.abs(target - entry) / risk).toFixed(2));
}

export function deriveSignalLevels(
  snapshot: FeatureSnapshot | null,
  action: string | null | undefined,
): SignalLevels | null {
  if (!snapshot || (action !== "long" && action !== "short")) {
    return null;
  }

  const plan = deriveTradePlan({
    snapshot,
    direction: action === "long" ? "buy" : "sell",
  });
  if (!plan) {
    return null;
  }

  return {
    entry: roundPrice(plan.entry),
    stop_loss: roundPrice(plan.sl),
    tp1: roundPrice(plan.tp1),
    tp2: plan.tp2 == null ? null : roundPrice(plan.tp2),
    tp3: plan.tp3 == null ? null : roundPrice(plan.tp3),
    invalidation_level: roundPrice(
      action === "long" ? plan.invalidation_zone.low : plan.invalidation_zone.high,
    ),
    risk_reward_ratio: calculateRiskReward(plan.entry, plan.sl, plan.tp1),
  };
}
