import type { TradePlanStyle } from "@/lib/assets";
import { getTimeframeProfile } from "@/lib/strategy/timeframeEngine";
import { detectRegime } from "@/lib/strategy/regimeEngine";
import { mapLiquidity } from "@/lib/strategy/liquidityMap";
import { analyzeStructure } from "@/lib/strategy/structureEngine";
import { detectTrap } from "@/lib/strategy/trapDetector";
import { classifySetup } from "@/lib/strategy/setupClassifier";
import { planExecution } from "@/lib/strategy/executionPlanner";
import { validateSetup } from "@/lib/strategy/setupValidator";
import type { MarketSnapshot, SetupFamily } from "@/lib/strategy/types";

export type PublishedStrategyPlan = {
  style: TradePlanStyle;
  setupFamily: SetupFamily | null;
  bias: "LONG" | "SHORT";
  timeframe: string;
  entryType: "LIMIT" | "STOP" | "NONE";
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  riskRewardRatio: number | null;
  invalidationLevel: number | null;
  regimeTag: string;
  liquidityThesis: string;
  trapThesis: string;
  thesis: string;
  executionNotes: string;
  status: "ACTIVE" | "NO_SETUP" | "STALE";
  setupScore: number;
  rank: "S" | "A" | "B" | "Silent";
  confidence: number;
  breakdown: {
    regimeAlignment: number;
    liquidityQuality: number;
    structureConfirmation: number;
    trapEdge: number;
    entryPrecision: number;
    riskReward: number;
    freshness: number;
  };
};

function toRank(score: number): "S" | "A" | "B" | "Silent" {
  if (score >= 85) return "S";
  if (score >= 70) return "A";
  if (score >= 55) return "B";
  return "Silent";
}

export function publishStrategyPlan(style: TradePlanStyle, snapshot: MarketSnapshot): PublishedStrategyPlan {
  const readiness = snapshot.styleReadiness?.[style];
  if (readiness && !readiness.ready) {
    const readinessReason = [
      readiness.missing.length > 0 ? `missing ${readiness.missing.join(", ")}` : null,
      readiness.stale.length > 0 ? `stale ${readiness.stale.join(", ")}` : null,
    ].filter(Boolean).join(" · ");

    return {
      style,
      setupFamily: null,
      bias: "LONG",
      timeframe: "Unavailable",
      entryType: "NONE",
      entryMin: null,
      entryMax: null,
      stopLoss: null,
      takeProfit1: null,
      takeProfit2: null,
      takeProfit3: null,
      riskRewardRatio: null,
      invalidationLevel: null,
      regimeTag: "unclear",
      liquidityThesis: "Required timeframe data is not fresh enough for this style.",
      trapThesis: "Trap detection disabled until required candles are available.",
      thesis: `No ${style.toLowerCase()} setup published because required timeframe data is unavailable.`,
      executionNotes: readinessReason ? `Readiness blocked: ${readinessReason}.` : "Readiness blocked.",
      status: "STALE",
      setupScore: 0,
      rank: "Silent",
      confidence: 0,
      breakdown: {
        regimeAlignment: 0,
        liquidityQuality: 0,
        structureConfirmation: 0,
        trapEdge: 0,
        entryPrecision: 0,
        riskReward: 0,
        freshness: 0,
      },
    };
  }

  const timeframe = getTimeframeProfile(style);
  const regime = detectRegime(snapshot);
  const liquidity = mapLiquidity(snapshot);
  const structure = analyzeStructure(snapshot);
  const trap = detectTrap(snapshot, regime, liquidity, structure);
  const setup = classifySetup({
    style,
    timeframe,
    snapshot,
    regime,
    liquidity,
    structure,
    trap,
  });
  const execution = planExecution({
    style,
    timeframe,
    snapshot,
    liquidity,
    structure,
    setup,
  });
  const validationResult = validateSetup({
    style,
    snapshot,
    regime,
    liquidity,
    structure,
    setup,
    execution,
  });

  const setupScore = Math.max(
    0,
    Math.round(
      regime.score +
      liquidity.score +
      structure.score +
      trap.score +
      (execution?.entryPrecisionScore ?? 0) +
      (execution?.riskRewardScore ?? 0) +
      validationResult.dataFreshnessScore
    )
  );
  const rank = validationResult.valid ? toRank(setupScore) : "Silent";
  const finalStatus = !validationResult.valid ? validationResult.status : rank === "Silent" ? "NO_SETUP" : "ACTIVE";
  const bias = setup.bias ?? structure.bias ?? regime.bias ?? "LONG";

  return {
    style,
    setupFamily: setup.family,
    bias,
    timeframe: execution?.timeframe ?? `${timeframe.execution} / ${timeframe.confirmation}`,
    entryType: validationResult.valid ? execution?.entryType ?? "NONE" : "NONE",
    entryMin: validationResult.valid ? execution?.entryMin ?? null : null,
    entryMax: validationResult.valid ? execution?.entryMax ?? null : null,
    stopLoss: validationResult.valid ? execution?.stopLoss ?? null : null,
    takeProfit1: validationResult.valid ? execution?.takeProfit1 ?? null : null,
    takeProfit2: validationResult.valid ? execution?.takeProfit2 ?? null : null,
    takeProfit3: validationResult.valid ? execution?.takeProfit3 ?? null : null,
    riskRewardRatio: validationResult.valid ? execution?.riskRewardRatio ?? null : null,
    invalidationLevel: validationResult.valid ? execution?.invalidationLevel ?? null : null,
    regimeTag: regime.tag,
    liquidityThesis: liquidity.thesis,
    trapThesis: trap.thesis,
    thesis: validationResult.valid
      ? `${setup.thesis} ${regime.thesis} ${snapshot.brief}`
      : validationResult.reason,
    executionNotes: validationResult.valid
      ? `${execution?.executionNotes ?? ""} ${validationResult.reason}`.trim()
      : validationResult.reason,
    status: finalStatus,
    setupScore,
    rank,
    confidence: Math.min(99, setupScore),
    breakdown: {
      regimeAlignment: regime.score,
      liquidityQuality: liquidity.score,
      structureConfirmation: structure.score,
      trapEdge: trap.score,
      entryPrecision: execution?.entryPrecisionScore ?? 0,
      riskReward: execution?.riskRewardScore ?? 0,
      freshness: validationResult.dataFreshnessScore,
    },
  };
}
