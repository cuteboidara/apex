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
  const move = snapshot.change24h ?? 0;
  const displacement = Math.abs(move) >= 0.45;
  const breakOfStructure = displacement && (normalized >= 0.6 || normalized <= 0.4);
  const reclaim = Math.abs(normalized - 0.5) <= 0.12;
  const failedContinuation = Math.abs(move) <= 0.12 && (normalized >= 0.75 || normalized <= 0.25);

  let bias: StrategyBias | null = null;
  if ((snapshot.trend === "uptrend" && normalized >= 0.45) || (snapshot.rsi ?? 50) >= 56) bias = "LONG";
  if ((snapshot.trend === "downtrend" && normalized <= 0.55) || (snapshot.rsi ?? 50) <= 44) {
    bias = bias === "LONG" ? bias : "SHORT";
  }

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
