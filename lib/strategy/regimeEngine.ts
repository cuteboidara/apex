import type { MarketSnapshot, RegimeAssessment, StrategyBias } from "@/lib/strategy/types";

export function detectRegime(snapshot: MarketSnapshot): RegimeAssessment {
  if (
    snapshot.stale ||
    snapshot.currentPrice == null ||
    snapshot.high14d == null ||
    snapshot.low14d == null ||
    snapshot.high14d <= snapshot.low14d
  ) {
    return {
      tag: "unclear",
      score: 0,
      bias: null,
      thesis: "Market regime is unclear because the live price or structure range is unavailable.",
      rangePct: null,
      clarity: "low",
    };
  }

  const rangePct = (snapshot.high14d - snapshot.low14d) / snapshot.currentPrice;
  const move = Math.abs(snapshot.change24h ?? 0);
  const trend = snapshot.trend ?? "consolidation";
  const momentumBullish = (snapshot.rsi ?? 50) >= 55;
  const momentumBearish = (snapshot.rsi ?? 50) <= 45;

  let tag: RegimeAssessment["tag"] = "range";
  let bias: StrategyBias | null = null;
  let score = 12;
  let clarity: RegimeAssessment["clarity"] = "medium";

  if (move >= 2.2 || rangePct >= 0.12) {
    tag = snapshot.newsSentimentScore !== 0 ? "post_news_volatility" : "expansion";
    score = 17;
    clarity = "medium";
  } else if (rangePct <= 0.018) {
    tag = "compression";
    score = 14;
    clarity = "medium";
  } else if (trend === "uptrend" || trend === "downtrend") {
    tag = "trend";
    score = 20;
    clarity = "high";
  } else if ((snapshot.rsi ?? 50) >= 42 && (snapshot.rsi ?? 50) <= 58) {
    tag = "mean_reversion";
    score = 15;
    clarity = "medium";
  }

  if (trend === "uptrend" || momentumBullish) bias = "LONG";
  if (trend === "downtrend" || momentumBearish) bias = bias === "LONG" ? bias : "SHORT";
  if (snapshot.macroBias === "risk_on" && bias == null) bias = "LONG";
  if (snapshot.macroBias === "risk_off" && bias == null) bias = "SHORT";
  if (bias == null) {
    clarity = "low";
    score = Math.min(score, 8);
  }

  return {
    tag,
    score,
    bias,
    thesis: `Regime is classified as ${tag.replace("_", " ")} with ${trend} context and ${move.toFixed(2)}% daily movement.`,
    rangePct,
    clarity,
  };
}
