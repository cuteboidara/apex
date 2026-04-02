/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import type { TradePlanStyle } from "@/lib/assets";
import { TRADE_PLAN_STYLES } from "@/lib/assets";
import type { Timeframe } from "@/lib/marketData/types";
import { publishStrategyPlan } from "@/lib/strategy/signalPublisher";
import type { StrategyDiagnostic } from "@/lib/strategy/types";

type PlannerSignal = {
  asset: string;
  assetClass: string;
  direction: "LONG" | "SHORT";
  total: number;
};

type PlannerData = {
  currentPrice: number | null;
  change24h: number | null;
  high14d: number | null;
  low14d: number | null;
  trend: string | null;
  rsi: number | null;
  stale: boolean;
  marketStatus?: "LIVE" | "DEGRADED" | "UNAVAILABLE";
  providerFallbackUsed?: boolean;
  candleProviders?: Partial<Record<Timeframe, {
    selectedProvider: string | null;
    fallbackUsed: boolean;
    freshnessMs: number | null;
    marketStatus: "LIVE" | "DEGRADED" | "UNAVAILABLE";
    reason: string | null;
  }>>;
  styleReadiness?: {
    SCALP: { ready: boolean; missing: Timeframe[]; stale: Timeframe[] };
    INTRADAY: { ready: boolean; missing: Timeframe[]; stale: Timeframe[] };
    SWING: { ready: boolean; missing: Timeframe[]; stale: Timeframe[] };
  };
  newsSentimentScore: number;
  macroBias: "risk_on" | "risk_off" | "neutral";
  brief: string;
};

export type PlannedTrade = {
  symbol: string;
  assetClass: string;
  style: TradePlanStyle;
  setupFamily: string | null;
  bias: "LONG" | "SHORT";
  confidence: number;
  timeframe: string;
  entryType: "LIMIT" | "STOP" | "NONE";
  entryMin: number | null;
  entryMax: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  riskRewardRatio: number | null;
  invalidationLevel: number | null;
  regimeTag: string;
  liquidityThesis: string;
  trapThesis: string;
  setupScore: number;
  publicationRank: "S" | "A" | "B" | "Silent";
  scoreBreakdown: {
    regimeAlignment: number;
    liquidityQuality: number;
    structureConfirmation: number;
    trapEdge: number;
    entryPrecision: number;
    riskReward: number;
    freshness: number;
  };
  thesis: string;
  executionNotes: string;
  status: "ACTIVE" | "NO_SETUP" | "STALE";
  diagnostics?: StrategyDiagnostic[];
};

export function buildTradePlans(signal: PlannerSignal, data: PlannerData): PlannedTrade[] {
  return TRADE_PLAN_STYLES.map(style => {
    const published = publishStrategyPlan(style, {
      symbol: signal.asset,
      assetClass: signal.assetClass,
      preferredBias: signal.direction,
      currentPrice: data.currentPrice,
      change24h: data.change24h,
      high14d: data.high14d,
      low14d: data.low14d,
      trend: data.trend,
      rsi: data.rsi,
      stale: data.stale,
      marketStatus: data.marketStatus,
      providerFallbackUsed: data.providerFallbackUsed,
      candleProviders: data.candleProviders,
      styleReadiness: data.styleReadiness,
      newsSentimentScore: data.newsSentimentScore,
      macroBias: data.macroBias,
      brief: data.brief,
    });

    return {
      symbol: signal.asset,
      assetClass: signal.assetClass,
      style,
      setupFamily: published.setupFamily,
      bias: published.bias,
      confidence: published.confidence,
      timeframe: published.timeframe,
      entryType: published.entryType,
      entryMin: published.entryMin,
      entryMax: published.entryMax,
      stopLoss: published.stopLoss,
      takeProfit1: published.takeProfit1,
      takeProfit2: published.takeProfit2,
      takeProfit3: published.takeProfit3,
      riskRewardRatio: published.riskRewardRatio,
      invalidationLevel: published.invalidationLevel,
      regimeTag: published.regimeTag,
      liquidityThesis: published.liquidityThesis,
      trapThesis: published.trapThesis,
      setupScore: published.setupScore,
      publicationRank: published.rank,
      scoreBreakdown: published.breakdown,
      thesis: published.thesis,
      executionNotes: published.executionNotes,
      status: published.status,
      diagnostics: published.diagnostics,
    };
  });
}

