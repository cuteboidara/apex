import type { TradePlanStyle } from "@/lib/assets";
import type {
  ExecutionPlan,
  LiquidityAssessment,
  MarketSnapshot,
  RegimeAssessment,
  SetupClassification,
  StructureAssessment,
  ValidationResult,
} from "@/lib/strategy/types";

const STOP_BOUNDS: Record<TradePlanStyle, { min: number; max: number }> = {
  SCALP: { min: 0.0005, max: 0.006 },
  INTRADAY: { min: 0.0008, max: 0.015 },
  SWING: { min: 0.0015, max: 0.04 },
};

export function validateSetup(input: {
  style: TradePlanStyle;
  snapshot: MarketSnapshot;
  regime: RegimeAssessment;
  liquidity: LiquidityAssessment;
  structure: StructureAssessment;
  setup: SetupClassification;
  execution: ExecutionPlan | null;
}): ValidationResult {
  const { style, snapshot, regime, liquidity, structure, setup, execution } = input;
  if (snapshot.stale) {
    return {
      valid: false,
      status: "STALE",
      reason: "Market data is stale, so the setup cannot be published.",
      dataFreshnessScore: 0,
    };
  }

  if (regime.tag === "unclear" || regime.clarity === "low" || regime.bias == null) {
    return {
      valid: false,
      status: "NO_SETUP",
      reason: "No clear regime is present for deterministic execution.",
      dataFreshnessScore: 5,
    };
  }

  if (!setup.valid || setup.bias == null) {
    return {
      valid: false,
      status: "NO_SETUP",
      reason: "Setup family or directional bias is not valid.",
      dataFreshnessScore: 5,
    };
  }

  if (liquidity.quality === "low" || liquidity.location === "mid") {
    return {
      valid: false,
      status: "NO_SETUP",
      reason: "Price is in a low-quality liquidity location.",
      dataFreshnessScore: 5,
    };
  }

  if (
    (structure.bias && structure.bias !== setup.bias) ||
    (regime.bias && regime.bias !== setup.bias)
  ) {
    return {
      valid: false,
      status: "NO_SETUP",
      reason: "Timeframe structure conflicts with the proposed setup bias.",
      dataFreshnessScore: 5,
    };
  }

  if (!execution) {
    return {
      valid: false,
      status: "NO_SETUP",
      reason: "Execution levels could not be calculated from the current structure.",
      dataFreshnessScore: 5,
    };
  }

  if (execution.riskUnit <= 0) {
    return {
      valid: false,
      status: "NO_SETUP",
      reason: "Risk unit is invalid.",
      dataFreshnessScore: 5,
    };
  }

  if (snapshot.currentPrice == null) {
    return {
      valid: false,
      status: "NO_SETUP",
      reason: "Current price is unavailable.",
      dataFreshnessScore: 5,
    };
  }

  const stopPct = execution.riskUnit / snapshot.currentPrice;
  const stopBounds = STOP_BOUNDS[style];
  if (stopPct < stopBounds.min) {
    return {
      valid: false,
      status: "NO_SETUP",
      reason: "Stop is unrealistically tight for the setup style.",
      dataFreshnessScore: 5,
    };
  }

  if (stopPct > stopBounds.max) {
    return {
      valid: false,
      status: "NO_SETUP",
      reason: "Stop is too wide for the setup style.",
      dataFreshnessScore: 5,
    };
  }

  if (execution.riskRewardRatio == null || execution.riskRewardRatio < 2) {
    return {
      valid: false,
      status: "NO_SETUP",
      reason: "TP1 does not achieve the minimum 2R objective.",
      dataFreshnessScore: 5,
    };
  }

  return {
    valid: true,
    status: "ACTIVE",
    reason: "Setup is valid for publication.",
    dataFreshnessScore: 5,
  };
}
