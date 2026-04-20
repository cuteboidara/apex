export type Session = "tokyo" | "london" | "ny" | "overlap" | "off";

export interface ScalpCandle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface UpcomingNewsEvent {
  impact?: string | null;
  time?: string | number | Date | null;
}

export interface ScalpAssetConfig {
  symbol: string;
  pipSize: number;
  category: "FX" | "METAL" | "INDEX" | "CRYPTO";
  preferredSessions: Session[];
}

export interface MultiTimeframeData {
  candles15m: ScalpCandle[];
  candles1h: ScalpCandle[];
  candles4h: ScalpCandle[];
  candlesDaily: ScalpCandle[];
  upcomingNews: UpcomingNewsEvent[];
}

export type TrendGateResult = {
  pass: boolean;
  score: number;
  alignedDirection: "long" | "short" | null;
  trend1h: "bullish" | "bearish" | "neutral";
  trend4h: "bullish" | "bearish" | "neutral";
  reasoning: string;
};

export type LevelGateResult = {
  pass: boolean;
  score: number;
  levelType?: string;
  levelPrice?: number;
  reasoning: string;
};

export type MomentumGateResult = {
  pass: boolean;
  score: number;
  confirmCount: number;
  rsi: number;
  macdHistogram: number;
  stochRsi: number;
  reasoning: string;
};

export type CandleGateResult = {
  pass: boolean;
  score: number;
  pattern?: string;
  quality?: number;
  reasoning: string;
};

export type ContextGateResult = {
  pass: boolean;
  score: number;
  session: Session;
  atrPct: number;
  newsBlocked: boolean;
  reasoning: string;
};

export type TradePlan = {
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  positionSize: number;
  riskUsd: number;
};

export type ScalpStatus = "ACTIVE" | "HIT_TP1" | "HIT_TP2" | "HIT_SL" | "EXPIRED";
