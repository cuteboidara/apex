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
  regime: RegimeAssessment,
  structure: StructureAssessment,
  liquidity: LiquidityAssessment
): "LONG" | "SHORT" | null {
  if (structure.bias && regime.bias && structure.bias === regime.bias) return structure.bias;
  if (structure.bias) return structure.bias;
  if (regime.bias) return regime.bias;
  if (liquidity.location === "discount") return "LONG";
  if (liquidity.location === "premium") return "SHORT";
  return null;
}

function styleThreshold(style: TradePlanStyle): number {
  switch (style) {
    case "SCALP":
      return 48;
    case "INTRADAY":
      return 54;
    case "SWING":
      return 60;
  }
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
      thesis: "Data is stale, so no setup can be classified.",
    };
  }

  const bias = chooseBias(regime, structure, liquidity);
  if (!bias) {
    return {
      valid: false,
      family: null,
      bias: null,
      entryType: "NONE",
      thesis: "Bias is conflicted across regime, liquidity, and structure.",
    };
  }

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
      thesis: `${style} alignment is too weak for publication.`,
    };
  }

  const family = trap.setupFamilyHint
    ?? (regime.tag === "range" ? "Mean-Reversion Reclaim" : "Trend Continuation After Re-accumulation");
  const entryType = family === "Breakout Acceptance" ? "STOP" : "LIMIT";

  return {
    valid: true,
    family,
    bias,
    entryType,
    thesis: `${family} selected on ${input.timeframe.execution} execution with ${input.timeframe.confirmation} confirmation.`,
  };
}
