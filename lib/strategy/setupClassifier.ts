import type { TradePlanStyle } from "@/lib/assets";
import type {
  LiquidityAssessment,
  MarketSnapshot,
  RegimeAssessment,
  SetupClassification,
  StructureAssessment,
  TimeframeProfile,
  TrapAssessment,
} from "@/lib/strategy/types";

function chooseBias(
  snapshot: MarketSnapshot,
  regime: RegimeAssessment,
  structure: StructureAssessment,
  liquidity: LiquidityAssessment,
  trap: TrapAssessment
): "LONG" | "SHORT" {
  let longScore = 0;
  let shortScore = 0;

  if (regime.bias === "LONG") longScore += 1;
  if (regime.bias === "SHORT") shortScore += 1;
  if (structure.bias === "LONG") longScore += 1;
  if (structure.bias === "SHORT") shortScore += 1;
  if (liquidity.location === "discount") longScore += 1;
  if (liquidity.location === "premium") shortScore += 1;

  switch (trap.setupFamilyHint) {
    case "Sweep Reversal":
      if (liquidity.sweepSide === "sellside") longScore += 2;
      if (liquidity.sweepSide === "buyside") shortScore += 2;
      break;
    case "Mean-Reversion Reclaim":
      if (liquidity.location === "discount") longScore += 1;
      if (liquidity.location === "premium") shortScore += 1;
      break;
    case "Breakout Acceptance":
    case "Displacement Pullback":
    case "Trend Continuation After Re-accumulation":
      if (snapshot.preferredBias === "LONG") longScore += 1;
      if (snapshot.preferredBias === "SHORT") shortScore += 1;
      break;
    default:
      break;
  }

  if (longScore > shortScore) return "LONG";
  if (shortScore > longScore) return "SHORT";
  return snapshot.preferredBias;
}

function styleThreshold(style: TradePlanStyle): number {
  switch (style) {
    case "SCALP":
      return 999;
    case "INTRADAY":
      return 60;
    case "SWING":
      return 64;
  }
}

function trendAligned(bias: "LONG" | "SHORT", trend: string | null) {
  if (trend == null || trend === "consolidation") return false;
  return (bias === "LONG" && trend === "uptrend") || (bias === "SHORT" && trend === "downtrend");
}

export function classifySetup(input: {
  style: TradePlanStyle;
  timeframe: TimeframeProfile;
  snapshot: MarketSnapshot;
  regime: RegimeAssessment;
  liquidity: LiquidityAssessment;
  structure: StructureAssessment;
  trap: TrapAssessment;
}): SetupClassification {
  const { style, snapshot, regime, liquidity, structure, trap } = input;

  if (snapshot.stale) {
    return {
      valid: false,
      family: null,
      bias: null,
      entryType: "NONE",
      confirmation: null,
      diagnostics: ["degraded_data"],
      thesis: "Data is stale, so no setup can be classified.",
    };
  }

  const bias = chooseBias(snapshot, regime, structure, liquidity, trap);

  const alignment =
    regime.score +
    liquidity.score +
    structure.score +
    trap.score;

  if (alignment < styleThreshold(style)) {
    return {
      valid: false,
      family: null,
      bias,
      entryType: "NONE",
      confirmation: null,
      diagnostics: liquidity.location === "mid" || liquidity.quality !== "high"
        ? ["weak_location"]
        : ["no_confirmation"],
      thesis: `${style} alignment is too weak for publication.`,
    };
  }

  const sweepAndReclaim =
    structure.reclaim &&
    ((bias === "LONG" && liquidity.sweepSide === "sellside") ||
      (bias === "SHORT" && liquidity.sweepSide === "buyside"));
  const breakAndHold =
    structure.breakOfStructure &&
    !structure.failedContinuation &&
    trendAligned(bias, snapshot.trend);
  const displacementPullback =
    structure.displacement &&
    (structure.marketStructureShift || structure.reclaim || liquidity.quality === "high") &&
    trendAligned(bias, snapshot.trend);
  const cleanRejection =
    structure.failedContinuation &&
    liquidity.quality === "high";

  let family: SetupClassification["family"] = null;
  let confirmation: SetupClassification["confirmation"] = null;

  if (sweepAndReclaim) {
    family = regime.tag === "mean_reversion" ? "Mean-Reversion Reclaim" : "Sweep Reversal";
    confirmation = "sweep_reclaim";
  } else if (displacementPullback && regime.tag !== "range" && regime.tag !== "mean_reversion") {
    family = "Displacement Pullback";
    confirmation = "displacement_pullback";
  } else if (breakAndHold && regime.tag === "compression") {
    family = "Trend Continuation After Re-accumulation";
    confirmation = "break_hold";
  } else if (breakAndHold) {
    family = "Breakout Acceptance";
    confirmation = "break_hold";
  } else if (cleanRejection && (regime.tag === "range" || regime.tag === "mean_reversion")) {
    family = "Mean-Reversion Reclaim";
    confirmation = "clean_rejection";
  } else if (cleanRejection && trendAligned(bias, snapshot.trend)) {
    family = "Trend Continuation After Re-accumulation";
    confirmation = "clean_rejection";
  }

  if (!family || !confirmation) {
    return {
      valid: false,
      family: null,
      bias,
      entryType: "NONE",
      confirmation: null,
      diagnostics: ["no_confirmation"],
      thesis: "Price is near an actionable level, but there is no confirmed entry trigger yet.",
    };
  }

  const entryType = family === "Breakout Acceptance" ? "STOP" : "LIMIT";

  return {
    valid: true,
    family,
    bias,
    entryType,
    confirmation,
    diagnostics: [],
    thesis: `${family} selected on ${input.timeframe.execution} execution with ${input.timeframe.confirmation} confirmation via ${confirmation.replaceAll("_", " ")}.`,
  };
}
