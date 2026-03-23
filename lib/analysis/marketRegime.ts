import type { MarketSnapshot, RegimeAssessment, StrategyBias } from "@/lib/strategy/types";

function normalizedRange(snapshot: Pick<MarketSnapshot, "currentPrice" | "high14d" | "low14d">) {
  if (
    snapshot.currentPrice == null ||
    snapshot.high14d == null ||
    snapshot.low14d == null ||
    snapshot.high14d <= snapshot.low14d
  ) {
    return null;
  }

  return (snapshot.high14d - snapshot.low14d) / snapshot.currentPrice;
}

function priceLocation(snapshot: Pick<MarketSnapshot, "currentPrice" | "high14d" | "low14d">) {
  if (
    snapshot.currentPrice == null ||
    snapshot.high14d == null ||
    snapshot.low14d == null ||
    snapshot.high14d <= snapshot.low14d
  ) {
    return null;
  }

  return (snapshot.currentPrice - snapshot.low14d) / (snapshot.high14d - snapshot.low14d);
}

function inferBias(snapshot: Pick<MarketSnapshot, "trend" | "rsi" | "macroBias">): StrategyBias | null {
  let longScore = 0;
  let shortScore = 0;

  if (snapshot.trend === "uptrend") longScore += 2;
  if (snapshot.trend === "downtrend") shortScore += 2;
  if ((snapshot.rsi ?? 50) >= 55) longScore += 1;
  if ((snapshot.rsi ?? 50) <= 45) shortScore += 1;
  if (snapshot.macroBias === "risk_on") longScore += 1;
  if (snapshot.macroBias === "risk_off") shortScore += 1;

  if (longScore > shortScore) return "LONG";
  if (shortScore > longScore) return "SHORT";
  return null;
}

export function assessMarketRegime(snapshot: MarketSnapshot): RegimeAssessment {
  const rangePct = normalizedRange(snapshot);
  const location = priceLocation(snapshot);
  const dailyMove = Math.abs(snapshot.change24h ?? 0);
  const bias = inferBias(snapshot);

  if (snapshot.stale || snapshot.currentPrice == null || rangePct == null) {
    return {
      tag: "unclear",
      family: "unclear",
      score: 0,
      bias: null,
      thesis: "Market regime is unclear because the live price or structural range is unavailable.",
      rangePct: null,
      clarity: "low",
      volatilityScore: null,
      breakoutBias: null,
    };
  }

  const volatile = dailyMove >= 2 || rangePct >= 0.1;
  const quiet = dailyMove <= 0.18 && rangePct <= 0.018;
  const trending = snapshot.trend === "uptrend" || snapshot.trend === "downtrend";
  const meanReverting = !trending && (snapshot.rsi ?? 50) >= 42 && (snapshot.rsi ?? 50) <= 58;
  const breakout =
    trending &&
    dailyMove >= 1 &&
    location != null &&
    ((bias === "LONG" && location >= 0.72) || (bias === "SHORT" && location <= 0.28));

  if (breakout) {
    return {
      tag: "expansion",
      family: "breakout",
      score: 22,
      bias,
      thesis: `Breakout regime: ${snapshot.trend} structure is pressing the edge of the 14-day range with ${dailyMove.toFixed(2)}% daily movement.`,
      rangePct,
      clarity: "high",
      volatilityScore: Math.round(rangePct * 1000) / 10,
      breakoutBias: bias,
    };
  }

  if (volatile) {
    return {
      tag: snapshot.newsSentimentScore !== 0 ? "post_news_volatility" : "expansion",
      family: "volatile",
      score: snapshot.newsSentimentScore !== 0 ? 18 : 17,
      bias,
      thesis: snapshot.newsSentimentScore !== 0
        ? `Volatile post-news regime with ${dailyMove.toFixed(2)}% daily movement and wide range expansion.`
        : `Volatile expansion regime with ${dailyMove.toFixed(2)}% daily movement across a ${(rangePct * 100).toFixed(1)}% range.`,
      rangePct,
      clarity: "medium",
      volatilityScore: Math.round(rangePct * 1000) / 10,
      breakoutBias: null,
    };
  }

  if (quiet) {
    return {
      tag: "compression",
      family: "quiet",
      score: 14,
      bias,
      thesis: `Quiet compression regime with limited range expansion and ${dailyMove.toFixed(2)}% daily movement.`,
      rangePct,
      clarity: "medium",
      volatilityScore: Math.round(rangePct * 1000) / 10,
      breakoutBias: null,
    };
  }

  if (trending) {
    return {
      tag: "trend",
      family: "trending",
      score: 20,
      bias,
      thesis: `Trending regime with ${snapshot.trend} structure, ${(snapshot.rsi ?? 50).toFixed(1)} RSI, and ${dailyMove.toFixed(2)}% daily movement.`,
      rangePct,
      clarity: bias ? "high" : "medium",
      volatilityScore: Math.round(rangePct * 1000) / 10,
      breakoutBias: null,
    };
  }

  if (meanReverting) {
    return {
      tag: "mean_reversion",
      family: "mean_reverting",
      score: 15,
      bias,
      thesis: "Mean-reversion regime with balanced momentum and no decisive trend continuation.",
      rangePct,
      clarity: bias ? "medium" : "low",
      volatilityScore: Math.round(rangePct * 1000) / 10,
      breakoutBias: null,
    };
  }

  return {
    tag: "range",
    family: "ranging",
    score: 12,
    bias,
    thesis: "Ranging regime with no decisive trend or breakout pressure.",
    rangePct,
    clarity: bias ? "medium" : "low",
    volatilityScore: Math.round(rangePct * 1000) / 10,
    breakoutBias: null,
  };
}
