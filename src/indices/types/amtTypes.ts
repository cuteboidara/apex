// src/indices/types/amtTypes.ts
// Auction Market Theory type definitions

import type { EconomicEvent } from './index';

// ─── Fair Value Area ──────────────────────────────────────────────────────────

export interface FairValueArea {
  center: number;        // VWAP
  upper: number;         // +1 std dev
  lower: number;         // -1 std dev
  strength: number;      // 0-100: % of candles whose close is inside FVA
  bandWidth: number;     // upper - lower (absolute)
  bandWidthPct: number;  // bandWidth / center (relative)
  lastUpdated: Date;
}

// ─── Candle Analysis ──────────────────────────────────────────────────────────

export type CandleDirection = 'bullish' | 'bearish' | 'indecision';
export type AggressionLevel = 'high' | 'medium' | 'low';

export interface CandleAnalysis {
  candleIndex: number;
  quality: number;              // 0-10
  direction: CandleDirection;
  bodyStrength: number;         // 0-1: body size / total range
  rejection: {
    upper: boolean;             // long upper wick
    lower: boolean;             // long lower wick
  };
  aggressiveness: AggressionLevel;
  reason: string;
}

export type SequentialPatternType =
  | 'strength_continuation'
  | 'rejection_after_aggression'
  | 'failed_auction_long'
  | 'failed_auction_short'
  | 'breakout_acceptance'
  | 'absorption';

export type PatternStrength = 'very_high' | 'high' | 'medium' | 'low';

export interface SequentialPattern {
  type: SequentialPatternType;
  strength: PatternStrength;
  candleRange: [number, number];  // start and end index
  description: string;
  probability: number;            // 0-1 estimated probability
}

// ─── Order Flow Confirmation ──────────────────────────────────────────────────

export type OrderFlowScenario =
  | 'failed_auction_long'
  | 'failed_auction_short'
  | 'breakout_acceptance'
  | 'none';

export interface OrderFlowConfirmation {
  confirmed: boolean;
  confidence: number;           // 0-100
  scenario: OrderFlowScenario;
  confirmationCandles: CandleAnalysis[];
  rejectionSignals: string[];   // reasons it might NOT confirm
  acceptanceSignals: string[];  // reasons it DOES confirm
  nextActionPrice: number | null;
  invalidationLevel: number;    // where setup logic breaks → SL here
}

// ─── Market Regime ────────────────────────────────────────────────────────────

export type DXYTrend = 'strong_up' | 'up' | 'neutral' | 'down' | 'strong_down';
export type VIXRegime = 'low' | 'normal' | 'high';
export type YieldTrend = 'rising' | 'stable' | 'falling';
export type CalendarRisk = 'clear' | 'caution' | 'blocked';
export type SentimentBias = 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed';

export interface MarketRegime {
  dxy: {
    trend: DXYTrend;
    value: number;
    change24h: number;
    alignment: number;          // -10 to +10 adjustment
  };
  vix: {
    regime: VIXRegime;
    value: number;
    volatilityAdjustment: number;  // SL size multiplier (e.g. 1.5× for high VIX)
    confidenceAdjustment: number;  // score adjustment
  };
  yields: {
    trend: YieldTrend;
    value: number;
    change5d: number;           // basis points
    equityBias: number;         // -10 to +10
  };
  calendar: {
    eventRisk: CalendarRisk;
    nextEvent: EconomicEvent | null;
    timeToEventMinutes: number;
    riskAdjustment: number;     // -30 to 0
  };
  sentiment: {
    fearGreed: number;          // 0-100
    bias: SentimentBias;
    contraryBias: number;       // -20 to +10 adjustment
  };
  combinedAdjustment: number;   // sum of all adjustments, clamped ±40
}

// ─── AMT Setup Types ──────────────────────────────────────────────────────────

export type AMTSetupType =
  | 'failed_auction_long'
  | 'failed_auction_short'
  | 'breakout_acceptance';

export type EntryStrategy = 'aggressive' | 'conservative';

export interface AMTSignal {
  rank: number;                    // 1, 2, 3
  assetId: string;
  setupType: AMTSetupType;
  direction: 'long' | 'short';

  // Scoring (sum = totalScore)
  candleQuality: number;           // 0-25
  orderFlowConfidence: number;     // 0-25
  smcTaAlignment: number;          // 0-20
  macroAdjustment: number;         // -20 to +20
  correlationBonus: number;        // 0-10
  totalScore: number;              // 0-100

  // Entry
  entryZone: { high: number; low: number; mid: number };
  entryStrategy: EntryStrategy;

  // Fair value context
  fairValueArea: FairValueArea;
  priceRelativeToFVA: 'below' | 'inside' | 'above';

  // Risk / reward
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskRewardRatio: number;         // headline RR (to TP2)

  // Sizing
  positionSize: number;            // lots
  riskAmount: number;              // $ at risk
  kellyFraction: number;

  // Confirmation evidence
  confirmationCandles: CandleAnalysis[];
  patterns: SequentialPattern[];
  orderFlowConfirmation: OrderFlowConfirmation;

  // Reasoning
  setupDescription: string;
  confirmationEvidence: string[];
  macroContext: string;
  executionPlan: string;

  // Meta
  generatedAt: Date;
  invalidationLevel: number;       // same as SL conceptually, but named for clarity
  newsRisk: CalendarRisk;
  regime: MarketRegime;
}

// ─── AMT Scoring Breakdown ────────────────────────────────────────────────────

export interface AMTScoreBreakdown {
  candleQuality: number;       // 0-25
  orderFlow: number;           // 0-25
  smcTa: number;               // 0-20
  macro: number;               // -20 to +20
  correlation: number;         // 0-10
  total: number;
}

// ─── Position Sizing ──────────────────────────────────────────────────────────

export interface AMTPositionSizing {
  accountSize: number;
  riskPct: number;
  riskAmount: number;
  kellyFraction: number;
  kellyFractional: number;     // half-Kelly
  confidenceMultiplier: number;
  adjustedKelly: number;
  stopDistancePts: number;
  lotSize: number;
  expectedValue: number;
}

// ─── Backtest Record ──────────────────────────────────────────────────────────

export interface AMTBacktestRecord {
  signalId: string;
  assetId: string;
  setupType: AMTSetupType;
  direction: 'long' | 'short';
  totalScore: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  generatedAt: Date;

  // Outcomes (filled in later)
  outcome: 'win_tp1' | 'win_tp2' | 'win_tp3' | 'loss' | 'breakeven' | 'pending';
  exitPrice: number | null;
  realizedRR: number | null;
  orderFlowAccurate: boolean | null;
  closedAt: Date | null;
}

// ─── Cycle Result ─────────────────────────────────────────────────────────────

export interface AMTCycleResult {
  cycleId: string;
  generatedAt: Date;
  signals: AMTSignal[];
  executable: AMTSignal[];
  watchlist: AMTSignal[];
  regime: MarketRegime;
  nextCycleAt: Date;
}
