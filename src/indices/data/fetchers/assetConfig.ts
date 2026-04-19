// src/indices/data/fetchers/assetConfig.ts
// Asset metadata: Yahoo Finance symbols, pip sizes, point values

export const ASSET_SYMBOLS = ['NAS100', 'SPX500', 'DAX', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'] as const;
export type AssetSymbol = typeof ASSET_SYMBOLS[number];

export const MACRO_SYMBOLS = ['DXY', 'VIX', 'TNX'] as const;
export type MacroSymbol = typeof MACRO_SYMBOLS[number];

export interface AssetConfig {
  symbol: AssetSymbol;
  yahooSymbol: string;       // Yahoo Finance ticker
  displayName: string;
  assetClass: 'index' | 'forex';
  pipSize: number;           // minimum price movement
  pointValue: number;        // $ per point (indices) or per pip (forex)
  minRR: number;             // minimum acceptable risk:reward
  minConfidence: number;     // minimum score to generate signal (0-100)
  typicalSpread: number;     // in points/pips
  sessionOpen: number;       // UTC hour when main session opens
  sessionClose: number;      // UTC hour when main session closes
}

export const ASSET_CONFIG: Record<AssetSymbol, AssetConfig> = {
  NAS100: {
    symbol: 'NAS100',
    yahooSymbol: 'NQ=F',        // Nasdaq 100 futures
    displayName: 'NASDAQ 100',
    assetClass: 'index',
    pipSize: 1,
    pointValue: 20,             // $20 per point (micro: $2)
    minRR: 1.5,
    minConfidence: 60,
    typicalSpread: 2,
    sessionOpen: 13,            // NYSE open 09:30 ET = 13:30 UTC
    sessionClose: 20,
  },
  SPX500: {
    symbol: 'SPX500',
    yahooSymbol: 'ES=F',        // S&P 500 futures
    displayName: 'S&P 500',
    assetClass: 'index',
    pipSize: 0.25,
    pointValue: 50,             // $50 per point (micro: $5)
    minRR: 1.5,
    minConfidence: 60,
    typicalSpread: 0.5,
    sessionOpen: 13,
    sessionClose: 20,
  },
  DAX: {
    symbol: 'DAX',
    yahooSymbol: '^GDAXI',      // DAX index (spot)
    displayName: 'DAX 40',
    assetClass: 'index',
    pipSize: 1,
    pointValue: 25,             // €25 per point (GER40 CFD)
    minRR: 1.5,
    minConfidence: 60,
    typicalSpread: 1,
    sessionOpen: 7,             // Frankfurt open 08:00 CET = 07:00 UTC
    sessionClose: 15,
  },
  EURUSD: {
    symbol: 'EURUSD',
    yahooSymbol: 'EURUSD=X',
    displayName: 'EUR/USD',
    assetClass: 'forex',
    pipSize: 0.0001,
    pointValue: 10,             // $10 per pip (standard lot)
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.1,
    sessionOpen: 7,
    sessionClose: 16,
  },
  GBPUSD: {
    symbol: 'GBPUSD',
    yahooSymbol: 'GBPUSD=X',
    displayName: 'GBP/USD',
    assetClass: 'forex',
    pipSize: 0.0001,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.2,
    sessionOpen: 7,
    sessionClose: 16,
  },
  USDJPY: {
    symbol: 'USDJPY',
    yahooSymbol: 'JPY=X',
    displayName: 'USD/JPY',
    assetClass: 'forex',
    pipSize: 0.01,
    pointValue: 9.1,            // ~$9.1 per pip at 110 rate
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.1,
    sessionOpen: 0,             // Tokyo open 09:00 JST = 00:00 UTC
    sessionClose: 8,
  },
  AUDUSD: {
    symbol: 'AUDUSD',
    yahooSymbol: 'AUDUSD=X',
    displayName: 'AUD/USD',
    assetClass: 'forex',
    pipSize: 0.0001,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.2,
    sessionOpen: 22,            // Sydney open
    sessionClose: 6,
  },
};

export const MACRO_CONFIG = {
  DXY: { yahooSymbol: 'DX-Y.NYB', displayName: 'US Dollar Index' },
  VIX: { yahooSymbol: '^VIX', displayName: 'CBOE Volatility Index' },
  TNX: { yahooSymbol: '^TNX', displayName: '10-Year Treasury Yield' },
};

export function getAssetConfig(symbol: AssetSymbol): AssetConfig {
  return ASSET_CONFIG[symbol];
}

export function isForex(symbol: AssetSymbol): boolean {
  return ASSET_CONFIG[symbol].assetClass === 'forex';
}

export function isIndex(symbol: AssetSymbol): boolean {
  return ASSET_CONFIG[symbol].assetClass === 'index';
}

// Yahoo Finance timeframe interval strings
export const YF_INTERVALS = {
  '1D': '1d',
  '4H': '4h',
  '1H': '1h',
  '1W': '1wk',
} as const;

// How many bars to fetch per timeframe
export const CANDLE_LIMITS = {
  '1W': 52,   // ~1 year
  '1D': 200,  // ~10 months
  '4H': 200,  // ~33 days
  '1H': 200,  // ~8 days
} as const;
