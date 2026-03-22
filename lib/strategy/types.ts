import type { TradePlanStyle } from "@/lib/assets";
import type { Style, Timeframe } from "@/lib/marketData/types";

export type StrategyBias = "LONG" | "SHORT";
export type StrategyDiagnostic =
  | "style_disabled"
  | "degraded_data"
  | "unclear_regime"
  | "weak_location"
  | "no_confirmation"
  | "conflicting_htf_bias"
  | "stop_invalid"
  | "tp1_not_viable"
  | "overextended_move";
export type SetupFamily =
  | "Sweep Reversal"
  | "Displacement Pullback"
  | "Breakout Acceptance"
  | "Mean-Reversion Reclaim"
  | "Trend Continuation After Re-accumulation";

export type RegimeTag =
  | "trend"
  | "range"
  | "expansion"
  | "compression"
  | "mean_reversion"
  | "post_news_volatility"
  | "unclear";

export type MarketSnapshot = {
  symbol: string;
  assetClass: string;
  preferredBias: StrategyBias;
  currentPrice: number | null;
  change24h: number | null;
  high14d: number | null;
  low14d: number | null;
  trend: string | null;
  rsi: number | null;
  stale: boolean;
  styleReadiness?: Record<Style, { ready: boolean; missing: Timeframe[]; stale: Timeframe[] }>;
  marketStatus?: "LIVE" | "DEGRADED" | "UNAVAILABLE";
  providerFallbackUsed?: boolean;
  candleProviders?: Partial<Record<Timeframe, {
    selectedProvider: string | null;
    fallbackUsed: boolean;
    freshnessMs: number | null;
    marketStatus: "LIVE" | "DEGRADED" | "UNAVAILABLE";
    reason: string | null;
    freshnessClass?: "fresh" | "stale" | "expired";
  }>>;
  newsSentimentScore: number;
  macroBias: "risk_on" | "risk_off" | "neutral";
  brief: string;
};

export type TimeframeProfile = {
  style: TradePlanStyle;
  execution: string;
  confirmation: string;
  holdingPeriod: string;
};

export type RegimeAssessment = {
  tag: RegimeTag;
  score: number;
  bias: StrategyBias | null;
  thesis: string;
  rangePct: number | null;
  clarity: "high" | "medium" | "low";
};

export type LiquidityAssessment = {
  score: number;
  sweepSide: "buyside" | "sellside" | "none";
  quality: "high" | "medium" | "low";
  location: "discount" | "premium" | "mid";
  thesis: string;
  levels: {
    previousDayHigh: number | null;
    previousDayLow: number | null;
    weeklyHigh: number | null;
    weeklyLow: number | null;
  };
};

export type StructureAssessment = {
  score: number;
  bias: StrategyBias | null;
  breakOfStructure: boolean;
  marketStructureShift: boolean;
  displacement: boolean;
  reclaim: boolean;
  failedContinuation: boolean;
  thesis: string;
};

export type TrapAssessment = {
  score: number;
  setupFamilyHint: SetupFamily | null;
  trapDetected: boolean;
  thesis: string;
};

export type SetupClassification = {
  valid: boolean;
  family: SetupFamily | null;
  bias: StrategyBias | null;
  entryType: "LIMIT" | "STOP" | "NONE";
  confirmation: "sweep_reclaim" | "break_hold" | "displacement_pullback" | "clean_rejection" | null;
  diagnostics: StrategyDiagnostic[];
  thesis: string;
};

export type ExecutionPlan = {
  timeframe: string;
  entryType: "LIMIT" | "STOP";
  entryMin: number;
  entryMax: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number | null;
  takeProfit3: number | null;
  invalidationLevel: number;
  riskUnit: number;
  riskRewardRatio: number | null;
  executionNotes: string;
  entryPrecisionScore: number;
  riskRewardScore: number;
};

export type ValidationResult = {
  valid: boolean;
  status: "ACTIVE" | "NO_SETUP" | "STALE";
  reason: string;
  diagnostics: StrategyDiagnostic[];
  dataFreshnessScore: number;
};
