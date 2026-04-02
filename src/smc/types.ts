export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface OrderBlock {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  midpoint: number;
  time: number;
  timeframe: "15m";
  broken: boolean;
  tested: boolean;
  strength: "strong" | "moderate" | "weak";
}

export interface FairValueGap {
  type: "bullish" | "bearish";
  upper: number;
  lower: number;
  midpoint: number;
  size: number;
  time: number;
  filled: boolean;
  partiallyFilled: boolean;
  fillPercent: number;
}

export interface BreakerBlock {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  midpoint: number;
  time: number;
  originalObType: "bullish" | "bearish";
}

export type LiquiditySide = "buyside" | "sellside";

export interface LiquidityLevel {
  side: LiquiditySide;
  price: number;
  time: number;
  swept: boolean;
  sweepTime?: number;
  sweepCandle?: Candle;
  type: "equal_highs" | "equal_lows" | "swing_high" | "swing_low" | "previous_day_high" | "previous_day_low";
}

export interface LiquiditySweep {
  side: LiquiditySide;
  level: LiquidityLevel;
  sweepCandle: Candle;
  reversal: boolean;
  reversalStrength: "strong" | "moderate" | "none";
}

export type KillzoneName = "asian_range" | "london_open" | "new_york_open" | "london_close" | "off_hours";

export interface KillzoneState {
  current: KillzoneName;
  isActive: boolean;
  sessionOpen: number | null;
  sessionHigh: number | null;
  sessionLow: number | null;
  minutesUntilNextKillzone: number;
  nextKillzone: KillzoneName;
  asianRangeHigh: number | null;
  asianRangeLow: number | null;
  asianRangeMidpoint: number | null;
}

export interface OTELevels {
  swing_high: number;
  swing_low: number;
  direction: "bullish" | "bearish";
  fib_62: number;
  fib_705: number;
  fib_79: number;
  ote_zone_upper: number;
  ote_zone_lower: number;
  currentPriceInOTE: boolean;
  distanceToOTE: number | null;
}

export type PDLocation = "premium" | "discount" | "equilibrium";

export interface PDArrays {
  rangeHigh: number;
  rangeLow: number;
  equilibrium: number;
  currentLocation: PDLocation;
  premiumThreshold: number;
  discountThreshold: number;
  currentPricePercent: number;
  pdLevels: {
    level: number;
    label: string;
    type: "premium" | "discount" | "equilibrium";
  }[];
}

export interface COTReport {
  symbol: string;
  reportDate: string;
  commercialLong: number;
  commercialShort: number;
  commercialNet: number;
  nonCommercialLong: number;
  nonCommercialShort: number;
  nonCommercialNet: number;
  retailLong: number;
  retailShort: number;
  retailNet: number;
  smartMoneyBias: "bullish" | "bearish" | "neutral";
  smartMoneyBiasStrength: "strong" | "moderate" | "weak";
  weeklyChange: number;
  divergence: boolean;
}

export interface SMCScore {
  orderBlockAlignment: number;
  fvgPresent: number;
  breakerConfirmation: number;
  liquidityContext: number;
  killzoneAlignment: number;
  oteAlignment: number;
  pdAlignment: number;
  cotAlignment: number;
  total: number;
  verdict: "strong_confluence" | "moderate_confluence" | "weak_confluence" | "no_confluence" | "counter_smc";
}

export interface SMCAnalysis {
  symbol: string;
  timestamp: number;
  orderBlocks: OrderBlock[];
  fairValueGaps: FairValueGap[];
  breakerBlocks: BreakerBlock[];
  liquidityLevels: LiquidityLevel[];
  recentSweeps: LiquiditySweep[];
  killzone: KillzoneState;
  ote: OTELevels | null;
  pdArrays: PDArrays;
  cot: COTReport | null;
  smcScore: SMCScore;
}
