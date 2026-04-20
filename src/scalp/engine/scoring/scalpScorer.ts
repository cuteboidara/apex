export function scoreScalpSignal(parts: {
  gate1Trend: number;
  gate2Level: number;
  gate3Momentum: number;
  gate4Candle: number;
  gate5Context: number;
}): number {
  const total = parts.gate1Trend + parts.gate2Level + parts.gate3Momentum + parts.gate4Candle + parts.gate5Context;
  return Math.max(0, Math.min(100, Math.round(total)));
}

export function scoreLabel(score: number): "EXECUTABLE" | "WATCHLIST" | "SKIP" {
  if (score >= 75) return "EXECUTABLE";
  if (score >= 60) return "WATCHLIST";
  return "SKIP";
}
