// src/presentation/indices/types.ts
// Shared types for the V2 dashboard (AMT signals as stored in IndicesSignal table)

export interface DBSignal {
  id: string;
  cycleId: string;
  assetId: string;
  assetClass: string;
  direction: 'long' | 'short';
  rank: number;
  smcScore: number;
  taScore: number;
  macroScore: number;
  quantBonus: number;
  totalScore: number;
  entryZoneHigh: number | null;
  entryZoneLow: number | null;
  entryZoneMid: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  riskRewardRatio: number | null;
  positionSize: number | null;
  riskAmount: number | null;
  historicalWinRate: number | null;
  expectedValue: number | null;
  newsRisk: string;
  reasoning: string | null;
  macroSummary: string | null;
  smcSetupJson: { setupType?: string; orderFlowConfirmation?: object } | null;
  taConfluenceJson: { patterns?: object[]; confirmationCandles?: object[] } | null;
  macroScoreJson: object | null;
  quantAnalysisJson: { kellyFraction?: number } | null;
  sentTelegram: boolean;
  createdAt: string;
}

export interface AssetState {
  assetId: string;
  lastScanned: string;   // ISO timestamp
  lastPrice: number;
  hasSignal: boolean;
  cycleId: string | null;
  updatedAt: string;
}

export interface CorrelationPair {
  asset1: string;
  asset2: string;
  correlation: number;
}

export interface MacroContextData {
  timestamp: string;
  dxy: {
    price: number;
    change24h: number;
    trend: 'up' | 'down' | 'neutral';
    sma20: number;
    strength: 'strong' | 'weak' | 'neutral';
  };
  vix: {
    price: number;
    change24h: number;
    regime: 'low' | 'normal' | 'high';
  };
  yield10y: {
    price: number;
    change5d: number;
    trend: 'up' | 'down' | 'stable';
  };
  sentiment: {
    fearGreed: number;
    classification: 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed';
  };
  economicEvents: Array<{
    time: string;
    country: string;
    event: string;
    impact: 'high' | 'medium' | 'low';
    forecast?: number;
    previous?: number;
    actual?: number;
  }>;
}
