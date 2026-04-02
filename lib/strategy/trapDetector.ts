/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import type {
  LiquidityAssessment,
  MarketSnapshot,
  RegimeAssessment,
  SetupFamily,
  StructureAssessment,
  TrapAssessment,
} from "@/lib/strategy/types";

export function detectTrap(
  snapshot: MarketSnapshot,
  regime: RegimeAssessment,
  liquidity: LiquidityAssessment,
  structure: StructureAssessment
): TrapAssessment {
  const lowFollowThrough = Math.abs(snapshot.change24h ?? 0) <= 0.18;

  let setupFamilyHint: SetupFamily | null = null;
  let thesis = "No clean trap or inefficiency edge is present.";
  let score = 6;

  if (liquidity.sweepSide !== "none" && (structure.reclaim || structure.failedContinuation)) {
    setupFamilyHint = "Sweep Reversal";
    thesis = `A ${liquidity.sweepSide} sweep appears to be failing back through the edge of the range.`;
    score = 15;
  } else if (structure.breakOfStructure && !structure.reclaim && !structure.failedContinuation && !lowFollowThrough) {
    setupFamilyHint = "Breakout Acceptance";
    thesis = "Breakout acceptance is supported by follow-through after the structural break.";
    score = 12;
  } else if (structure.displacement && regime.tag !== "range" && (structure.reclaim || liquidity.location === "mid")) {
    setupFamilyHint = "Displacement Pullback";
    thesis = "Price expanded with displacement, creating a pullback entry into inefficiency.";
    score = 13;
  } else if (regime.tag === "mean_reversion" && structure.reclaim) {
    setupFamilyHint = "Mean-Reversion Reclaim";
    thesis = "Price is reclaiming back through the midpoint after a mean-reversion flush.";
    score = 12;
  } else if (regime.tag === "compression" && structure.bias != null) {
    setupFamilyHint = "Trend Continuation After Re-accumulation";
    thesis = "Compression is resolving in the direction of the higher-quality structure bias.";
    score = 11;
  }

  return {
    score,
    setupFamilyHint,
    trapDetected: setupFamilyHint != null,
    thesis,
  };
}

