/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import type { TradePlanStyle } from "@/lib/assets";
import { getTimeframeProfile } from "@/lib/strategy/timeframeEngine";
import { detectRegime } from "@/lib/strategy/regimeEngine";
import { mapLiquidity } from "@/lib/strategy/liquidityMap";
import { analyzeStructure } from "@/lib/strategy/structureEngine";
import { detectTrap } from "@/lib/strategy/trapDetector";
import { classifySetup } from "@/lib/strategy/setupClassifier";
import { planExecution } from "@/lib/strategy/executionPlanner";
import { validateSetup } from "@/lib/strategy/setupValidator";
import type { MarketSnapshot, SetupFamily, StrategyDiagnostic } from "@/lib/strategy/types";

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
  diagnostics: StrategyDiagnostic[];
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
  if (score >= 88) return "S";
  if (score >= 76) return "A";
  if (score >= 66) return "B";
  return "Silent";
}

function blockedPlan(
  style: TradePlanStyle,
  snapshot: MarketSnapshot,
  diagnostics: StrategyDiagnostic[],
  reason: string,
  status: "NO_SETUP" | "STALE" = "NO_SETUP"
): PublishedStrategyPlan {
  return {
    style,
    setupFamily: null,
    bias: snapshot.preferredBias,
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
    liquidityThesis: reason,
    trapThesis: reason,
    thesis: reason,
    executionNotes: `Rejected: ${diagnostics.join(", ")}`,
    status,
    diagnostics,
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

function providerPenalty(snapshot: MarketSnapshot) {
  let penalty = 0;

  if (snapshot.marketStatus && snapshot.marketStatus !== "LIVE") {
    penalty += 12;
  }

  if (snapshot.providerFallbackUsed) {
    penalty += 8;
  }

  const degradedCandles = Object.values(snapshot.candleProviders ?? {}).filter(provider =>
    provider != null && (provider.marketStatus !== "LIVE" || provider.fallbackUsed)
  ).length;

  penalty += Math.min(12, degradedCandles * 3);
  return penalty;
}

function isYahooDailyOnly(snapshot: MarketSnapshot, style: TradePlanStyle): boolean {
  if (style !== "SCALP") return false;
  const candle = snapshot.candleProviders?.["1m"];
  const provider = candle?.selectedProvider ?? "";
  const readiness = snapshot.styleReadiness?.SCALP;
  const intradayReady = readiness?.ready === true && candle?.marketStatus === "LIVE" && candle?.fallbackUsed !== true;
  return (provider.includes("Yahoo") || provider === "") && !intradayReady;
}

export function publishStrategyPlan(style: TradePlanStyle, snapshot: MarketSnapshot): PublishedStrategyPlan {
  // Yahoo Finance only provides daily OHLC data. SCALP requires sub-minute
  // precision that daily data cannot support — block it for all non-crypto assets.
  if (isYahooDailyOnly(snapshot, style)) {
    return blockedPlan(
      style,
      snapshot,
      ["degraded_data"],
      "SCALP skipped: asset data sourced from Yahoo Finance (daily only, no intraday candles)."
    );
  }

  const readiness = snapshot.styleReadiness?.[style];
  const readinessReason = readiness
    ? [
      readiness.missing.length > 0 ? `missing ${readiness.missing.join(", ")}` : null,
      readiness.stale.length > 0 ? `stale ${readiness.stale.join(", ")}` : null,
    ].filter(Boolean).join(" · ")
    : "";

  if (!readiness || !readiness.ready) {
    return blockedPlan(
      style,
      snapshot,
      ["degraded_data"],
      readinessReason
        ? `Required timeframe data is not publishable for ${style.toLowerCase()} setups: ${readinessReason}.`
        : `Required timeframe data is not publishable for ${style.toLowerCase()} setups.`,
      "STALE"
    );
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
      validationResult.dataFreshnessScore -
      providerPenalty(snapshot)
    )
  );
  const rank = validationResult.valid ? toRank(setupScore) : "Silent";
  const finalStatus = !validationResult.valid ? validationResult.status : rank === "Silent" ? "NO_SETUP" : "ACTIVE";
  const bias = setup.bias ?? structure.bias ?? regime.bias ?? snapshot.preferredBias;
  const executionNotes = validationResult.valid
    ? `${execution?.executionNotes ?? ""} ${validationResult.reason}`.trim()
    : validationResult.reason;

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
    executionNotes,
    status: finalStatus,
    diagnostics: validationResult.valid ? setup.diagnostics : validationResult.diagnostics,
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

