import type { TradePlanStyle } from "@/lib/assets";

type SetupInput = {
  style: TradePlanStyle;
  bias: "LONG" | "SHORT";
  totalScore: number;
  trend: string | null;
  rsi: number | null;
  currentPrice: number | null;
  high14d: number | null;
  low14d: number | null;
  stale: boolean;
};

type SetupClassification =
  | {
      status: "ACTIVE";
      entryType: "LIMIT" | "STOP";
      explanation: string;
      confidence: number;
    }
  | {
      status: "NO_SETUP" | "STALE";
      explanation: string;
      confidence: number;
    };

const STYLE_MIN_SCORE: Record<TradePlanStyle, number> = {
  SCALP: 50,
  INTRADAY: 58,
  SWING: 62,
};

export function classifySetup(input: SetupInput): SetupClassification {
  if (input.stale || input.currentPrice == null || input.high14d == null || input.low14d == null) {
    return {
      status: "STALE",
      explanation: "Live price or structure inputs are stale, so the platform will not publish exact levels.",
      confidence: Math.max(0, input.totalScore - 20),
    };
  }

  if (input.totalScore < STYLE_MIN_SCORE[input.style]) {
    return {
      status: "NO_SETUP",
      explanation: `Score ${input.totalScore} is below the ${input.style.toLowerCase()} threshold.`,
      confidence: input.totalScore,
    };
  }

  const range = input.high14d - input.low14d;
  const normalizedPosition = range > 0 ? (input.currentPrice - input.low14d) / range : 0.5;
  const trendAligned =
    (input.bias === "LONG" && input.trend === "uptrend") ||
    (input.bias === "SHORT" && input.trend === "downtrend");
  const momentumAligned =
    input.rsi == null ||
    (input.bias === "LONG" ? input.rsi >= 48 : input.rsi <= 52);

  if (!trendAligned && input.style === "SWING") {
    return {
      status: "NO_SETUP",
      explanation: "Higher timeframe trend is not aligned enough for a swing plan.",
      confidence: input.totalScore - 8,
    };
  }

  if (!momentumAligned) {
    return {
      status: "NO_SETUP",
      explanation: "Momentum is not aligned with the directional bias.",
      confidence: input.totalScore - 10,
    };
  }

  const favorPullback =
    (input.bias === "LONG" && normalizedPosition <= 0.55) ||
    (input.bias === "SHORT" && normalizedPosition >= 0.45);

  return {
    status: "ACTIVE",
    entryType: favorPullback ? "LIMIT" : "STOP",
    explanation: favorPullback
      ? `${input.style} setup is classified as a pullback continuation inside a valid structure zone.`
      : `${input.style} setup is classified as a breakout continuation with momentum support.`,
    confidence: Math.min(99, input.totalScore + (trendAligned ? 6 : 0) + (momentumAligned ? 4 : 0)),
  };
}
