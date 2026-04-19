// src/indices/data/fetchers/assetConfig.ts
// Asset metadata: Yahoo Finance symbols, pip sizes, point values

export const ASSET_SYMBOLS = [
  // Indices (8)
  'NAS100',
  'SPX500',
  'DAX',
  'FTSE100',
  'NIKKEI',
  'HANGSENG',
  'CAC40',
  'ASX200',
  // FX (8)
  'EURUSD',
  'GBPUSD',
  'USDJPY',
  'AUDUSD',
  'USDCAD',
  'USDCHF',
  'EURJPY',
  'GBPJPY',
  // Commodities (6)
  'XAUUSD',
  'XAGUSD',
  'USOIL',
  'UKOIL',
  'NATGAS',
  'COPPER',
  // Rates (5)
  'US10Y',
  'US2Y',
  'DE10Y',
  'JP10Y',
  'UK10Y',
] as const;
export type AssetSymbol = typeof ASSET_SYMBOLS[number];

export const MACRO_SYMBOLS = ['DXY', 'VIX', 'TNX'] as const;
export type MacroSymbol = typeof MACRO_SYMBOLS[number];

export interface AssetConfig {
  symbol: AssetSymbol;
  yahooSymbol: string;       // Yahoo Finance ticker
  displayName: string;
  assetClass: 'index' | 'forex' | 'commodity' | 'rate';
  pipSize: number;           // minimum price movement
  pointValue: number;        // $ per point (indices) or per pip (forex)
  minRR: number;             // minimum acceptable risk:reward
  minConfidence: number;     // minimum score to generate signal (0-100)
  typicalSpread: number;     // in points/pips
  sessionOpen: number;       // UTC hour when main session opens
  sessionClose: number;      // UTC hour when main session closes
}

export const ASSET_CONFIG: Record<AssetSymbol, AssetConfig> = {
  // ─── Indices ───────────────────────────────────────────────────────────────
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
  FTSE100: {
    symbol: 'FTSE100',
    yahooSymbol: '^FTSE',
    displayName: 'FTSE 100',
    assetClass: 'index',
    pipSize: 1,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 60,
    typicalSpread: 1,
    sessionOpen: 8,             // London open 08:00 UTC
    sessionClose: 16,
  },
  NIKKEI: {
    symbol: 'NIKKEI',
    yahooSymbol: '^N225',
    displayName: 'Nikkei 225',
    assetClass: 'index',
    pipSize: 1,
    pointValue: 5,
    minRR: 1.5,
    minConfidence: 60,
    typicalSpread: 5,
    sessionOpen: 0,             // Tokyo open 09:00 JST = 00:00 UTC
    sessionClose: 6,
  },
  HANGSENG: {
    symbol: 'HANGSENG',
    yahooSymbol: '^HSI',
    displayName: 'Hang Seng',
    assetClass: 'index',
    pipSize: 1,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 60,
    typicalSpread: 5,
    sessionOpen: 1,             // HK open 09:30 HKT = 01:30 UTC
    sessionClose: 8,
  },
  CAC40: {
    symbol: 'CAC40',
    yahooSymbol: '^FCHI',
    displayName: 'CAC 40',
    assetClass: 'index',
    pipSize: 0.5,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 60,
    typicalSpread: 1,
    sessionOpen: 7,             // Paris open 09:00 CET = 07:00 UTC
    sessionClose: 15,
  },
  ASX200: {
    symbol: 'ASX200',
    yahooSymbol: '^AXJO',
    displayName: 'ASX 200',
    assetClass: 'index',
    pipSize: 0.5,
    pointValue: 25,
    minRR: 1.5,
    minConfidence: 60,
    typicalSpread: 2,
    sessionOpen: 23,            // Sydney open 10:00 AEST = 23:00 UTC (prev day)
    sessionClose: 5,
  },

  // ─── FX ───────────────────────────────────────────────────────────────────
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
  USDCAD: {
    symbol: 'USDCAD',
    yahooSymbol: 'CAD=X',
    displayName: 'USD/CAD',
    assetClass: 'forex',
    pipSize: 0.0001,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.2,
    sessionOpen: 12,
    sessionClose: 21,
  },
  USDCHF: {
    symbol: 'USDCHF',
    yahooSymbol: 'CHF=X',
    displayName: 'USD/CHF',
    assetClass: 'forex',
    pipSize: 0.0001,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.2,
    sessionOpen: 7,
    sessionClose: 16,
  },
  EURJPY: {
    symbol: 'EURJPY',
    yahooSymbol: 'EURJPY=X',
    displayName: 'EUR/JPY',
    assetClass: 'forex',
    pipSize: 0.01,
    pointValue: 9.1,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.2,
    sessionOpen: 0,
    sessionClose: 16,
  },
  GBPJPY: {
    symbol: 'GBPJPY',
    yahooSymbol: 'GBPJPY=X',
    displayName: 'GBP/JPY',
    assetClass: 'forex',
    pipSize: 0.01,
    pointValue: 9.1,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.3,
    sessionOpen: 0,
    sessionClose: 16,
  },

  // ─── Commodities ──────────────────────────────────────────────────────────
  XAUUSD: {
    symbol: 'XAUUSD',
    yahooSymbol: 'GC=F',        // Gold futures
    displayName: 'Gold',
    assetClass: 'commodity',
    pipSize: 0.1,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.3,
    sessionOpen: 8,
    sessionClose: 17,
  },
  XAGUSD: {
    symbol: 'XAGUSD',
    yahooSymbol: 'SI=F',        // Silver futures
    displayName: 'Silver',
    assetClass: 'commodity',
    pipSize: 0.005,
    pointValue: 50,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.02,
    sessionOpen: 8,
    sessionClose: 17,
  },
  USOIL: {
    symbol: 'USOIL',
    yahooSymbol: 'CL=F',        // WTI Crude futures
    displayName: 'WTI Crude',
    assetClass: 'commodity',
    pipSize: 0.01,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.03,
    sessionOpen: 8,
    sessionClose: 17,
  },
  UKOIL: {
    symbol: 'UKOIL',
    yahooSymbol: 'BZ=F',        // Brent Crude futures
    displayName: 'Brent Crude',
    assetClass: 'commodity',
    pipSize: 0.01,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.03,
    sessionOpen: 8,
    sessionClose: 17,
  },
  NATGAS: {
    symbol: 'NATGAS',
    yahooSymbol: 'NG=F',        // Natural Gas futures
    displayName: 'Natural Gas',
    assetClass: 'commodity',
    pipSize: 0.001,
    pointValue: 10,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.005,
    sessionOpen: 8,
    sessionClose: 17,
  },
  COPPER: {
    symbol: 'COPPER',
    yahooSymbol: 'HG=F',        // Copper futures
    displayName: 'Copper',
    assetClass: 'commodity',
    pipSize: 0.0005,
    pointValue: 250,
    minRR: 1.5,
    minConfidence: 55,
    typicalSpread: 0.002,
    sessionOpen: 8,
    sessionClose: 17,
  },

  // ─── Rates ────────────────────────────────────────────────────────────────
  US10Y: {
    symbol: 'US10Y',
    yahooSymbol: '^TNX',        // US 10Y Treasury yield
    displayName: 'US 10Y',
    assetClass: 'rate',
    pipSize: 0.001,
    pointValue: 1000,
    minRR: 1.5,
    minConfidence: 50,
    typicalSpread: 0.005,
    sessionOpen: 13,
    sessionClose: 20,
  },
  US2Y: {
    symbol: 'US2Y',
    yahooSymbol: '^IRX',        // 13-week T-bill (US 2Y proxy)
    displayName: 'US 2Y',
    assetClass: 'rate',
    pipSize: 0.001,
    pointValue: 1000,
    minRR: 1.5,
    minConfidence: 50,
    typicalSpread: 0.005,
    sessionOpen: 13,
    sessionClose: 20,
  },
  DE10Y: {
    symbol: 'DE10Y',
    yahooSymbol: '^BUND',       // German 10Y Bund (may need fallback)
    displayName: 'German 10Y',
    assetClass: 'rate',
    pipSize: 0.001,
    pointValue: 1000,
    minRR: 1.5,
    minConfidence: 50,
    typicalSpread: 0.005,
    sessionOpen: 7,
    sessionClose: 15,
  },
  JP10Y: {
    symbol: 'JP10Y',
    yahooSymbol: '^IRJP10Y',    // Japan 10Y (may need fallback)
    displayName: 'Japan 10Y',
    assetClass: 'rate',
    pipSize: 0.001,
    pointValue: 1000,
    minRR: 1.5,
    minConfidence: 50,
    typicalSpread: 0.005,
    sessionOpen: 0,
    sessionClose: 6,
  },
  UK10Y: {
    symbol: 'UK10Y',
    yahooSymbol: '^TMBMKGB-10Y', // UK Gilt 10Y (may need fallback)
    displayName: 'UK 10Y',
    assetClass: 'rate',
    pipSize: 0.001,
    pointValue: 1000,
    minRR: 1.5,
    minConfidence: 50,
    typicalSpread: 0.005,
    sessionOpen: 8,
    sessionClose: 16,
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

export function isCommodity(symbol: AssetSymbol): boolean {
  return ASSET_CONFIG[symbol].assetClass === 'commodity';
}

export function isRate(symbol: AssetSymbol): boolean {
  return ASSET_CONFIG[symbol].assetClass === 'rate';
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
