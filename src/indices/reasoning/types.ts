import type { Candle, MacroContext } from '@/src/indices/types';

export type DecisionAction = 'EXECUTE' | 'WATCH' | 'SKIP';

export interface ReasoningSignalInput {
  id: string;
  cycleId: string;
  assetId: string;
  direction: 'long' | 'short';
  setupType: string;
  totalScore: number;
  entryZone: {
    high: number;
    low: number;
    mid: number;
  };
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskRewardRatio: number;
  positionSize: number;
  riskAmount: number;
  candleQuality: number;
  orderFlowConfidence: number;
  smcTaAlignment: number;
  macroAdjustment: number;
  correlationBonus: number;
}

export interface RecentSignalOutcome {
  id: string;
  assetId: string;
  totalScore: number;
  outcome: 'win' | 'loss' | 'pending';
  createdAt: string;
}

export interface ReasoningMarketData {
  recentCandles: Candle[];
  currentPrice: number | null;
}

export interface AgentContext {
  signal: ReasoningSignalInput;
  marketData: ReasoningMarketData;
  macroContext: MacroContext;
  recentSignals?: RecentSignalOutcome[];
}

export interface AnalystOutput {
  conviction: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  keyLevels: {
    criticalSupport: number;
    criticalResistance: number;
    invalidationPrice: number;
  };
}

export interface RiskOutput {
  riskScore: number;
  warnings: string[];
  criticalConcerns: string[];
  suggestedSlAdjustment: {
    shouldAdjust: boolean;
    newStopLoss: number | null;
    reason: string;
  };
  shouldBlock: boolean;
  summary: string;
}

export interface MacroOutput {
  alignmentScore: number;
  supportingFactors: string[];
  conflictingFactors: string[];
  newsRisk: {
    level: 'clear' | 'caution' | 'high';
    blockingEvents: string[];
  };
  regimeContext: string;
  summary: string;
}

export interface DecisionOutput {
  action: DecisionAction;
  scoreDelta: number;
  finalScore: number;
  confidence: number;
  primaryReasoning: string;
  keyFactors: {
    supporting: string[];
    opposing: string[];
  };
  executionGuidance: {
    useOriginalLevels: boolean;
    adjustedStopLoss: number | null;
    scaleInRecommended: boolean;
    monitorFor: string[];
  };
  agentConsensus: 'aligned' | 'conflicted' | 'split';
  tradeQualityGrade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface AgentRunResult<TOutput> {
  agentName: string;
  output: TOutput;
  reasoning: string;
  latencyMs: number;
  tokensUsed: number;
  costUsd: number;
}

export interface ReasoningAnalysisResult {
  signalId: string;
  assetId: string;
  signalScore: number;
  analyst: AnalystOutput;
  risk: RiskOutput;
  macro: MacroOutput;
  decision: DecisionOutput;
  metrics: {
    latencyMs: number;
    tokensUsed: number;
    costUsd: number;
  };
}
