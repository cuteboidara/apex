// src/indices/types/index.ts
// Core type definitions for indices trading system

// ============================================================================
// MARKET DATA TYPES
// ============================================================================

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timeframe: '1D' | '4H' | '1H';
}

export interface AssetData {
  asset: string; // 'NAS100' | 'SPX500' | 'DAX' | 'EURUSD' | etc
  candles: Candle[];
  currentPrice: number;
  lastUpdate: Date;
}

export interface MacroContext {
  timestamp: Date;
  dxy: {
    price: number;
    change24h: number; // percentage
    trend: 'up' | 'down' | 'neutral';
    sma20: number;
    strength: 'strong' | 'weak' | 'neutral';
  };
  vix: {
    price: number;
    change24h: number;
    regime: 'low' | 'normal' | 'high'; // <15, 15-25, >25
  };
  yield10y: {
    price: number;
    change5d: number; // basis points
    trend: 'up' | 'down' | 'stable';
  };
  sentiment: {
    fearGreed: number; // 0-100
    classification:
      | 'extreme_fear'
      | 'fear'
      | 'neutral'
      | 'greed'
      | 'extreme_greed';
  };
  economicEvents: EconomicEvent[];
}

export interface EconomicEvent {
  time: Date;
  country: string;
  event: string;
  impact: 'low' | 'medium' | 'high';
  forecast?: number;
  previous?: number;
  actual?: number;
}

// ============================================================================
// SMC ENGINE TYPES
// ============================================================================

export interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  timestamp: Date;
  confirmed: boolean;
}

export interface OrderBlock {
  assetId: string;
  timestamp: Date;
  type: 'bullish' | 'bearish';
  high: number;
  low: number;
  mid: number;
  range: number;
  depth: number; // how many candles in consolidation
  liquiditySwept: boolean;
  sweptPrice?: number;
  sweptTimestamp?: Date;
  quality: number; // 0-15 points
  daysOld: number;
}

export interface FairValueGap {
  assetId: string;
  timestamp: Date;
  type: 'bullish' | 'bearish';
  gapHigh: number;
  gapLow: number;
  fillPrice?: number;
  fillTimestamp?: Date;
  quality: number; // 0-10 points
  daysOld: number;
}

export interface SMCSetup {
  assetId: string;
  scanTimestamp: Date;
  direction: 'bullish' | 'bearish';

  // Order block
  orderBlock: OrderBlock;

  // Fair value gap
  fvg?: FairValueGap;

  // Entry zone (where to enter)
  entryZoneHigh: number;
  entryZoneLow: number;
  entryZoneMid: number;

  // Stop loss (below/above order block)
  stopLossLevel: number;
  stopLossBuffer: number; // % for slippage

  // Quality scoring
  smcScore: number; // 0-40 points
  orderBlockQuality: number; // 0-15
  fvgQuality: number; // 0-10
  liquidityQuality: number; // 0-15

  // Reasoning
  reasoning: string[];
}

// ============================================================================
// TECHNICAL ANALYSIS TYPES
// ============================================================================

export interface HTFBias {
  weekly: {
    trend: 'bullish' | 'bearish' | 'neutral';
    price: number;
    sma: number;
    strength: number; // -1 to 1
  };
  daily: {
    trend: 'bullish' | 'bearish' | 'neutral';
    price: number;
    sma: number;
    strength: number; // -1 to 1
  };
  combined: 'strong_bullish' | 'bullish' | 'neutral' | 'bearish' | 'strong_bearish';
  alignment: number; // 0-10 points
}

export interface PivotLevels {
  pivot: number;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
}

export interface RSIData {
  value: number;
  state: 'overbought' | 'neutral' | 'oversold';
  divergence?: 'bullish' | 'bearish'; // if detected
  quality: number; // 0-7 points
}

export interface VolumeCluster {
  price: number;
  volume: number;
  strength: 'weak' | 'medium' | 'strong';
}

export interface FibonacciLevel {
  ratio: number; // 0.236, 0.382, 0.5, 0.618, etc
  price: number;
  type: 'retracement' | 'extension';
}

export interface TAConfluence {
  assetId: string;
  timestamp: Date;

  // Higher timeframe bias
  htfBias: HTFBias;
  biasPoints: number; // 0-10

  // Pivot levels
  pivots: PivotLevels;
  pivotProximity: number; // 0-8 points

  // RSI
  rsi: RSIData;
  rsiPoints: number; // 0-7

  // Volume
  volumeClusters: VolumeCluster[];
  volumePoints: number; // 0-5

  // Fibonacci
  fibonacciLevels: FibonacciLevel[];
  fibPoints: number; // 0-5

  // Total TA score
  taScore: number; // 0-30 points
}

// ============================================================================
// MACRO TYPES
// ============================================================================

export interface MacroScore {
  assetId: string;
  timestamp: Date;

  // DXY analysis
  dxyStrength: 'strong' | 'weak' | 'neutral';
  dxyAlignment: number; // 0-8 points

  // VIX regime
  vixRegime: 'low' | 'normal' | 'high';
  vixPoints: number; // 0-5

  // Yields
  yieldTrend: 'up' | 'down' | 'stable';
  yieldPoints: number; // 0-5

  // Economic calendar
  eventRisk: 'clear' | 'caution' | 'blocked';
  eventPoints: number; // 0-5 or -10 if blocked
  eventDetails?: EconomicEvent;

  // Sentiment
  sentiment: 'extreme_fear' | 'fear' | 'neutral' | 'greed' | 'extreme_greed';
  sentimentPoints: number; // 0-5

  // Total macro score
  macroScore: number; // 0-20 points
}

// ============================================================================
// QUANTITATIVE TYPES
// ============================================================================

export interface CorrelationPair {
  asset1: string;
  asset2: string;
  correlation: number; // -1 to 1
  strength: 'strong_negative' | 'moderate_negative' | 'weak' | 'moderate_positive' | 'strong_positive';
}

export interface QuantAnalysis {
  assetId: string;
  timestamp: Date;

  // Correlation matrix
  correlations: CorrelationPair[];
  correlatedAssets: string[]; // Assets also signaling
  correlationBonus: number; // 0-10 points

  // Beta
  beta: number; // asset volatility relative to market
  betaInterpretation: 'high_volatility' | 'market_level' | 'low_volatility';

  // Sharpe ratio
  sharpeRatio: number;
  sharpeInterpretation: 'excellent' | 'good' | 'acceptable' | 'poor';

  // Kelly Criterion
  kellyFraction: number; // suggested % of account
  kellyFractional: number; // Kelly / 2 (safer)

  // Position sizing
  suggestedPositionSize: number; // in lots/units
  suggestedRiskAmount: number; // in $ or account %

  // Quality metrics
  expectedValue: number; // EV > 0 = edge
}

// ============================================================================
// SIGNAL & RANKING TYPES
// ============================================================================

export interface TradeManagementPlan {
  entryZone: {
    high: number;
    low: number;
    mid: number;
  };
  stopLoss: number;
  stopLossBuffer: number; // for slippage
  takeProfits: {
    tp1: { level: number; closePercentage: number }; // 33%
    tp2: { level: number; closePercentage: number }; // 33%
    tp3: { level: number; closePercentage: number }; // 34%
  };
  riskRewardRatio: number;
  maxReward: number;
  totalRisk: number;
  scaleInLevels?: number[];
  scaleOutRules: string[];
  trailingStopRule?: string;
  executionNotes: string[];
}

export interface RankedSignal {
  // Identity
  rank: number; // 1, 2, 3
  assetId: string;
  scanTimestamp: Date;
  direction: 'long' | 'short';

  // Scores
  scores: {
    smc: number; // 0-40
    ta: number; // 0-30
    macro: number; // 0-20
    quantBonus: number; // 0-10
    total: number; // 0-100
  };

  // Full analysis
  smcSetup: SMCSetup;
  taConfluence: TAConfluence;
  macroScore: MacroScore;
  quantAnalysis: QuantAnalysis;

  // Trade management
  tradeManagement: TradeManagementPlan;
  positionSize: number; // lots/units
  riskAmount: number; // $

  // Reasoning & context
  reasoning: string;
  correlations: {
    asset: string;
    correlation: number;
    isAlsoSignaling: boolean;
  }[];

  // Historical performance
  historicalWinRate: number; // % based on similar setups
  historicalAvgRR: number;
  totalBacktestedTrades: number;

  // Macro summary
  macroSummary: string;
  newsRisk: 'clear' | 'caution' | 'blocked';
}

export interface SignalAlert {
  timestamp: Date;
  signals: RankedSignal[]; // Top 3
  summary: string;
  telegramText: string;
  emailSubject: string;
  emailBody: string;
}

// ============================================================================
// TRADE EXECUTION TYPES
// ============================================================================

export interface TradeExecution {
  id: string;
  signalId: string;
  assetId: string;
  direction: 'long' | 'short';

  entry: {
    price: number;
    timestamp: Date;
    lotSize: number;
  };

  stopLoss: {
    level: number;
    hitPrice?: number;
    hitTimestamp?: Date;
  };

  takeProfits: {
    tp1: { level: number; closePrice?: number; closeTime?: Date };
    tp2: { level: number; closePrice?: number; closeTime?: Date };
    tp3: { level: number; closePrice?: number; closeTime?: Date };
  };

  // Results
  status: 'open' | 'partial' | 'closed';
  exitPrice?: number;
  exitTimestamp?: Date;
  profitLoss?: number;
  returnPct?: number;

  // Metrics
  maxDrawdown?: number;
  timeInTrade?: number; // minutes
}

// ============================================================================
// SETTINGS TYPES
// ============================================================================

export interface IndicesSystemSettings {
  minSignalScore: number; // default 60
  riskPerTrade: number; // 1% of account
  maxConcurrentTrades: number; // default 1
  maxCorrelatedTrades: number; // default 1
  scanFrequencyMinutes: number; // default 240 (4h)
  assetsEnabled: string[]; // which ones to scan

  // SMC settings
  swingLookback: number; // periods
  orderBlockMinDepth: number; // candles
  orderBlockMaxRange: number; // % of price

  // TA settings
  rsiPeriod: number;
  smaPeriod: number;
  volumeLookback: number;

  // Macro settings
  skipNewsWindows: number; // minutes before/after event

  // Notifications
  telegramEnabled: boolean;
  emailEnabled: boolean;
  dashboardEnabled: boolean;

  // Paper vs Live
  mode: 'paper' | 'live';
  accountSize: number;
}

// All types are exported inline via `export interface` above.
