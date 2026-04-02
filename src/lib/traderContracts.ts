import type { PairMarketDataDiagnostics, PodVoteSummary, SignalLifecycleRecord } from "@/src/interfaces/contracts";

export const TRADER_SIGNAL_GRADES = ["S+", "S", "A", "B", "C", "D", "F"] as const;
export type TraderSignalGrade = typeof TRADER_SIGNAL_GRADES[number];

export type TraderDirection = "long" | "short" | "neutral";
export type TraderBias = "bullish" | "bearish" | "neutral";
export type TraderStructureLabel = "BOS" | "CHOCH" | "trend continuation" | "range" | "neutral";
export type TraderLiquidityState = "liquidity sweep" | "no sweep" | "neutral";
export type TraderLocation = "premium" | "discount" | "equilibrium" | "neutral";
export type TraderZoneType = "demand" | "supply" | "order block" | "POI" | "neutral";
export type TraderMarketPhase = "accumulation" | "expansion" | "distribution" | "pullback" | "neutral";
export type TraderSetupType =
  | "trend pullback"
  | "session breakout"
  | "range reversal"
  | "liquidity sweep reversal"
  | "continuation after BOS"
  | "session continuation";
export type TraderSignalStatus = "active" | "watchlist" | "blocked" | "invalidated" | "expired";
export type TraderNoTradeReason =
  | "off session"
  | "low volatility"
  | "no structure"
  | "blocked by risk"
  | "awaiting setup"
  | "data unavailable";
export type TraderMarketStateLabel =
  | "dead market"
  | "low liquidity"
  | "active session"
  | "expansion"
  | "pullback";

export type TraderDetailedReasoning = {
  whyThisIsASetup: string;
  whyNow: string;
  whyThisLevel: string;
  whatWouldInvalidateIt: string;
  whyItGotItsGrade: string;
};

export type TraderKeyLevels = {
  previousDayHigh: number | null;
  previousDayLow: number | null;
  sessionHigh: number | null;
  sessionLow: number | null;
  location: TraderLocation;
  activeZone: string | null;
};

/**
 * @deprecated TraderDashboardSignal is superseded by SignalViewModel from src/domain/models/signalPipeline.ts.
 * Still used internally during cycle enrichment and compatibility responses. Target removal: Phase 5.
 */
export type TraderDashboardSignal = {
  symbol: string;
  livePrice: number | null;
  direction: TraderDirection;
  grade: TraderSignalGrade;
  setupType: TraderSetupType;
  session: string;
  bias: TraderBias;
  structure: TraderStructureLabel;
  liquidityState: TraderLiquidityState;
  location: TraderLocation;
  zoneType: TraderZoneType;
  marketPhase: TraderMarketPhase;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  entryTimeframe?: string | null;
  tp1RiskReward?: number | null;
  tp2RiskReward?: number | null;
  htfBiasSummary?: string | null;
  liquiditySweepDescription?: string | null;
  confluenceScore?: number | null;
  shortReasoning: string;
  detailedReasoning: TraderDetailedReasoning;
  whyThisSetup?: string;
  whyNow?: string;
  whyThisLevel?: string;
  invalidation?: string;
  whyThisGrade?: string;
  noTradeExplanation?: string | null;
  marketStructureSummary: string;
  liquiditySummary: string;
  keyLevelsSummary: string;
  keyLevels: TraderKeyLevels;
  noTradeReason: TraderNoTradeReason | null;
  whyNotValid: string | null;
  marketStateLabels: TraderMarketStateLabel[];
  status: TraderSignalStatus;
  blockedReasons: string[];
  latestLifecycle: SignalLifecycleRecord | null;
  lifecycleState: string | null;
  confidence: number;
  podVoteSummary: PodVoteSummary | null;
  smcAnalysis?: {
    nearestOrderBlock: { type: "bullish" | "bearish"; high: number; low: number; strength: string } | null;
    nearestFVG: { type: "bullish" | "bearish"; upper: number; lower: number; fillPercent: number } | null;
    nearestBreaker: { type: "bullish" | "bearish"; high: number; low: number } | null;
    recentLiquiditySweep: { side: "buyside" | "sellside"; reversal: boolean; reversalStrength: string } | null;
    killzone: string;
    minutesToNextKillzone: number;
    nextKillzone: string;
    asianRangeHigh: number | null;
    asianRangeLow: number | null;
    inOTE: boolean;
    oteLevels: { fib62: number; fib705: number; fib79: number } | null;
    pdLocation: "premium" | "discount" | "equilibrium";
    pdPercent: number;
    cotBias: string;
    cotStrength: string;
    cotDivergence: boolean;
    smcScore: number;
    smcVerdict: string;
  };
};

export type TraderSnapshotDiagnostics = {
  symbol: string;
  cycleId: string;
  generatedAt: number;
  marketData: PairMarketDataDiagnostics;
  snapshotAvailable: boolean;
  snapshotCreated: boolean;
  snapshotTimestamp: number | null;
  candidateCreated: boolean;
  traderCardCreated: boolean;
  cardStatus: TraderSignalStatus | null;
  approvalStatus: string | null;
  noTradeReason: string | null;
  blockedReasons: string[];
  unavailableReason: string | null;
  providerStatus?: string | null;
  publicationStatus?: string | null;
  dataTrustScore?: number | null;
  healthFlags?: string[];
};

export type TraderPairRuntimeState = {
  symbol: string;
  cycleId: string;
  generatedAt: number;
  snapshotAvailable: boolean;
  liveMarket: TraderLiveMarketRow;
  marketReasoning: TraderMarketReasoningRow;
  keyAreas: TraderKeyAreasRow;
  card: TraderDashboardSignal | null;
  diagnostics: TraderSnapshotDiagnostics;
};

export type TraderLiveMarketRow = {
  symbol: string;
  livePrice: number | null;
  session: string;
  bias: TraderBias;
  grade: TraderSignalGrade | null;
  noTradeReason: TraderNoTradeReason | null;
  marketStateLabels: TraderMarketStateLabel[];
  status: TraderSignalStatus;
};

export type TraderMarketReasoningRow = {
  symbol: string;
  summary: string;
  grade: TraderSignalGrade | null;
  noTradeReason: TraderNoTradeReason | null;
  marketStateLabels: TraderMarketStateLabel[];
  status: TraderSignalStatus;
};

export type TraderKeyAreasRow = TraderKeyLevels & {
  symbol: string;
};

export type TraderOperatorPreferences = {
  meaningfulSignalFloor: "B";
  minimumTelegramGrade: TraderSignalGrade;
  includeBTelegramSignals: boolean;
  showBlockedSignalsOnMainDashboard: boolean;
  showAdvancedInternals: boolean;
};

export type TraderMarketCommentary = {
  overallContext: string;
  sessionNote: string;
  topOpportunity: string;
  riskNote: string;
};

export type TraderSignalsPayload = {
  generatedAt: number;
  cards: TraderDashboardSignal[];
  liveMarketBoard: TraderLiveMarketRow[];
  activeSignals: TraderDashboardSignal[];
  developingSetups: TraderDashboardSignal[];
  blockedSignals: TraderDashboardSignal[];
  watchlistSignals: TraderDashboardSignal[];
  marketReasoning: TraderMarketReasoningRow[];
  keyAreas: TraderKeyAreasRow[];
  diagnostics: TraderSnapshotDiagnostics[];
  preferences: TraderOperatorPreferences;
  marketCommentary?: TraderMarketCommentary | null;
  pipelineDiagnostics?: Record<string, unknown> | null;
};
