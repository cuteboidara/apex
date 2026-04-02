/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import type { TradePlanStyle } from "@/lib/assets";
import type {
  ExecutionPlan,
  LiquidityAssessment,
  MarketSnapshot,
  RegimeAssessment,
  SetupClassification,
  StrategyBias,
  StrategyDiagnostic,
  StructureAssessment,
  ValidationResult,
} from "@/lib/strategy/types";

const STOP_BOUNDS: Record<TradePlanStyle, { min: number; max: number }> = {
  SCALP: { min: 0.0005, max: 0.006 },
  INTRADAY: { min: 0.001, max: 0.012 },
  SWING: { min: 0.002, max: 0.03 },
};

const STOP_MAX_TOLERANCE = 1;
const REQUIRED_TIMEFRAMES: Record<TradePlanStyle, Array<"1m" | "5m" | "15m" | "1h" | "4h" | "1D">> = {
  SCALP: ["1m", "5m"],
  INTRADAY: ["5m", "15m", "1h"],
  SWING: ["1h", "4h", "1D"],
};

function diagnosticReason(code: StrategyDiagnostic) {
  switch (code) {
    case "style_disabled":
      return "Style publication is disabled.";
    case "degraded_data":
      return "Required candles or providers are degraded, stale, or fallback-only.";
    case "unclear_regime":
      return "The higher-timeframe regime is not clear enough for publication.";
    case "weak_location":
      return "Price is in weak liquidity or sitting in the middle of the range.";
    case "no_confirmation":
      return "No confirmed entry trigger is present.";
    case "conflicting_htf_bias":
      return "Higher-timeframe directional bias conflicts with the setup.";
    case "stop_invalid":
      return "Structure-based stop placement is invalid for the selected style.";
    case "tp1_not_viable":
      return "TP1 does not offer a realistic minimum 2R objective.";
    case "overextended_move":
      return "The move is already overextended and not attractive for a new entry.";
  }
}

function uniqueDiagnostics(codes: StrategyDiagnostic[]) {
  return [...new Set(codes)];
}

function trendBias(trend: string | null): StrategyBias | null {
  if (trend === "uptrend") return "LONG";
  if (trend === "downtrend") return "SHORT";
  return null;
}

function hasHealthyCriticalData(snapshot: MarketSnapshot, style: TradePlanStyle) {
  const readiness = snapshot.styleReadiness?.[style];
  if (!readiness?.ready || snapshot.marketStatus !== "LIVE" || snapshot.providerFallbackUsed) {
    return false;
  }

  const providers = snapshot.candleProviders;
  if (!providers) {
    return false;
  }

  return REQUIRED_TIMEFRAMES[style].every(timeframe => {
    const provider = providers[timeframe];
    return provider != null && provider.marketStatus === "LIVE" && !provider.fallbackUsed;
  });
}

function higherTimeframeConflict(
  style: TradePlanStyle,
  bias: StrategyBias,
  snapshot: MarketSnapshot,
  regime: RegimeAssessment,
  structure: StructureAssessment
) {
  const htfTrendBias = trendBias(snapshot.trend);

  if (style === "INTRADAY") {
    return (htfTrendBias != null && htfTrendBias !== bias) || (structure.bias != null && structure.bias !== bias);
  }

  if (style === "SWING") {
    return (
      (htfTrendBias != null && htfTrendBias !== bias) ||
      (regime.bias != null && regime.bias !== bias) ||
      (structure.bias != null && structure.bias !== bias)
    );
  }

  return false;
}

function isOverextended(style: TradePlanStyle, snapshot: MarketSnapshot, bias: StrategyBias) {
  if (
    snapshot.currentPrice == null ||
    snapshot.high14d == null ||
    snapshot.low14d == null ||
    snapshot.high14d <= snapshot.low14d
  ) {
    return false;
  }

  const normalized = (snapshot.currentPrice - snapshot.low14d) / (snapshot.high14d - snapshot.low14d);
  const move = Math.abs(snapshot.change24h ?? 0);
  const threshold = style === "SWING" ? 1.8 : 1.1;

  if (bias === "LONG") {
    return normalized >= 0.82 && move >= threshold;
  }

  return normalized <= 0.18 && move >= threshold;
}

function tp1Reachable(snapshot: MarketSnapshot, execution: ExecutionPlan, bias: StrategyBias) {
  const averageEntry = (execution.entryMin + execution.entryMax) / 2;
  const reachableReward = bias === "LONG"
    ? (snapshot.high14d ?? averageEntry) - averageEntry
    : averageEntry - (snapshot.low14d ?? averageEntry);
  return reachableReward >= execution.riskUnit * 2;
}

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
  const diagnostics: StrategyDiagnostic[] = [];

  // Detect Yahoo Finance daily-only provider — short-tf structure signals unavailable
  const isYahooDaily =
    snapshot.candleProviders?.["1m"]?.selectedProvider?.includes("Yahoo") === true;

  if (snapshot.stale) {
    diagnostics.push("degraded_data");
  }

  if (!hasHealthyCriticalData(snapshot, style)) {
    diagnostics.push("degraded_data");
  }

  if (regime.tag === "unclear" || regime.clarity === "low") {
    diagnostics.push("unclear_regime");
  }

  if (!setup.valid || setup.bias == null || setup.confirmation == null) {
    diagnostics.push(...setup.diagnostics);
  }

  // For Yahoo daily-only assets, skip liquidity quality and HTF conflict checks —
  // these derive from short-tf candles that are not available.
  if (!isYahooDaily) {
    if (liquidity.quality !== "high" || liquidity.location === "mid") {
      diagnostics.push("weak_location");
    }

    if (setup.bias != null && higherTimeframeConflict(style, setup.bias, snapshot, regime, structure)) {
      diagnostics.push("conflicting_htf_bias");
    }
  }

  if (setup.bias != null && isOverextended(style, snapshot, setup.bias)) {
    diagnostics.push("overextended_move");
  }

  if (
    !execution ||
    execution.riskUnit <= 0 ||
    snapshot.currentPrice == null ||
    (
      setup.bias === "LONG" &&
      (execution.stopLoss >= execution.invalidationLevel || execution.invalidationLevel >= execution.entryMin)
    ) ||
    (
      setup.bias === "SHORT" &&
      (execution.stopLoss <= execution.invalidationLevel || execution.invalidationLevel <= execution.entryMax)
    )
  ) {
    diagnostics.push("stop_invalid");
  }

  if (execution && snapshot.currentPrice != null) {
    const stopPct = execution.riskUnit / snapshot.currentPrice;
    const stopBounds = STOP_BOUNDS[style];
    if (stopPct < stopBounds.min || stopPct > stopBounds.max * STOP_MAX_TOLERANCE) {
      diagnostics.push("stop_invalid");
    }
  }

  if (
    !execution ||
    execution.riskRewardRatio == null ||
    execution.riskRewardRatio < 2 ||
    setup.bias == null ||
    !tp1Reachable(snapshot, execution, setup.bias)
  ) {
    diagnostics.push("tp1_not_viable");
  }

  const dedupedDiagnostics = uniqueDiagnostics(diagnostics);
  if (dedupedDiagnostics.length > 0) {
    const primary = dedupedDiagnostics[0];
    return {
      valid: false,
      status: primary === "degraded_data" ? "STALE" : "NO_SETUP",
      reason: diagnosticReason(primary),
      diagnostics: dedupedDiagnostics,
      dataFreshnessScore: 0,
    };
  }

  return {
    valid: true,
    status: "ACTIVE",
    reason: "Setup is valid for publication.",
    diagnostics: [],
    dataFreshnessScore: 5,
  };
}

