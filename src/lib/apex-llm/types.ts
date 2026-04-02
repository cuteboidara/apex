export interface SignalReasoningContext {
  symbol: string;
  direction: "buy" | "sell" | "neutral";
  grade: string;
  setupType: string;
  session: string;
  bias: string;
  structure: string;
  liquidityState: string;
  location: string;
  zoneType: string;
  marketPhase: string;
  confidence: number;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  livePrice: number | null;
  noTradeReason: string | null;
  blockedReasons: string[];
  vetoes: string[];
  podVoteSummary: Record<string, unknown> | null;
  marketStateLabels: string[];
  keyLevels: {
    pdh: number | null;
    pdl: number | null;
    sessionHigh: number | null;
    sessionLow: number | null;
  };
  smcContext?: {
    orderBlock: string | null;
    fvg: string | null;
    killzone: string;
    pdLocation: string;
    inOTE: boolean;
    cotBias: string;
    smcVerdict: string;
    recentSweep: string | null;
  };
}

export interface SignalReasoningOutput {
  shortReasoning: string;
  detailedReasoning: string;
  whyThisSetup: string;
  whyNow: string;
  whyThisLevel: string;
  invalidation: string;
  whyThisGrade: string;
  marketStructureSummary: string;
  liquiditySummary: string;
  keyLevelsSummary: string;
  noTradeExplanation: string | null;
}

export interface MarketCommentaryState {
  bias: string;
  phase: string;
  session: string;
  labels: string[];
}

export interface MarketCommentaryOutput {
  overallContext: string;
  sessionNote: string;
  topOpportunity: string;
  riskNote: string;
}
