export type Session = "tokyo" | "london" | "ny" | "overlap" | "off";

export type SniperSetupType =
  | "liquidity_sweep_long"
  | "liquidity_sweep_short"
  | "bos_continuation_long"
  | "bos_continuation_short";

export type SniperDirection = "long" | "short";

export interface SniperCandle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface LiquidityLevel {
  type: "high" | "low";
  price: number;
  timestamp: Date;
  candleIndex: number;
  strength: number;
  swept: boolean;
  sweepCandle?: number;
}

export interface SweepEvent {
  level: LiquidityLevel;
  sweepCandleIndex: number;
  sweepPrice: number;
  rejectionStrength: number;
  closeBack: boolean;
  sweepType: "bullish" | "bearish";
}

export interface StructureSnapshot {
  trend: "up" | "down" | "neutral";
  nearestResistance: number;
  nearestSupport: number;
}

export interface SniperSetup {
  assetId: string;
  setupType: SniperSetupType;
  direction: SniperDirection;
  score: number;
  sweepQuality: number;
  rejection: number;
  structure: number;
  session: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  sweepLevel: number;
  structureLevel: number;
  sweepCandleTime: Date;
  currentSession: Session;
  description: string;
}

