/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import type { MarketSnapshot, StructureAssessment, StrategyBias } from "@/lib/strategy/types";

export function analyzeStructure(snapshot: MarketSnapshot): StructureAssessment {
  if (
    snapshot.currentPrice == null ||
    snapshot.high14d == null ||
    snapshot.low14d == null ||
    snapshot.high14d <= snapshot.low14d
  ) {
    return {
      score: 0,
      bias: null,
      breakOfStructure: false,
      marketStructureShift: false,
      displacement: false,
      reclaim: false,
      failedContinuation: false,
      thesis: "Structure engine is inactive because the range is incomplete.",
    };
  }

  const range = snapshot.high14d - snapshot.low14d;
  const normalized = (snapshot.currentPrice - snapshot.low14d) / range;
  const clampedNormalized = Math.max(0, Math.min(1, normalized));
  const impulse = snapshot.change24h ?? 0;
  const displacement = Math.abs(impulse) >= 0.45;
  const breakOfStructure = displacement && (clampedNormalized >= 0.6 || clampedNormalized <= 0.4);
  const reclaim = Math.abs(clampedNormalized - 0.5) <= 0.12;
  const failedContinuation = Math.abs(impulse) <= 0.12 && (clampedNormalized >= 0.75 || clampedNormalized <= 0.25);

  const longScore =
    ((snapshot.trend === "uptrend" && clampedNormalized >= 0.45) ? 2 : 0) +
    (((snapshot.rsi ?? 50) >= 56 && clampedNormalized <= 0.65) ? 1 : 0) +
    ((impulse >= 0.35 && clampedNormalized >= 0.5) ? 1 : 0) +
    (clampedNormalized <= 0.25 ? 1 : 0);
  const shortScore =
    ((snapshot.trend === "downtrend" && clampedNormalized <= 0.55) ? 2 : 0) +
    (((snapshot.rsi ?? 50) <= 44 && clampedNormalized >= 0.35) ? 1 : 0) +
    ((impulse <= -0.35 && clampedNormalized <= 0.5) ? 1 : 0) +
    (clampedNormalized >= 0.75 ? 1 : 0);
  const bias: StrategyBias | null = longScore > shortScore ? "LONG" : shortScore > longScore ? "SHORT" : null;

  return {
    score: breakOfStructure ? 20 : reclaim ? 16 : 9,
    bias,
    breakOfStructure,
    marketStructureShift: breakOfStructure && reclaim,
    displacement,
    reclaim,
    failedContinuation,
    thesis: breakOfStructure
      ? "Structure shows directional displacement and break-of-structure behavior."
      : reclaim
        ? "Structure is reclaiming the midpoint after a failed extension."
        : "Structure is mixed and lacks strong directional confirmation.",
  };
}

