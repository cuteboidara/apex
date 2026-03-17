export type AssetClass = "CRYPTO" | "FOREX" | "COMMODITY";
export type ProviderName = "Binance" | "Alpha Vantage" | "Twelve Data";
export type MarketStatus = "LIVE" | "DEGRADED" | "UNAVAILABLE";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1D";
export type Style = "SCALP" | "INTRADAY" | "SWING";

export type QuoteResult = {
  symbol: string;
  assetClass: AssetClass;
  provider: ProviderName;
  price: number | null;
  change24h: number | null;
  high14d: number | null;
  low14d: number | null;
  volume: number | null;
  timestamp: number | null;
  stale: boolean;
  marketStatus: MarketStatus;
  reason: string | null;
  closes?: number[];
};

export type CandleBar = {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  timestamp: number;
};

export type CandleResult = {
  symbol: string;
  assetClass: AssetClass;
  provider: ProviderName;
  timeframe: Timeframe;
  candles: CandleBar[];
  timestamp: number | null;
  stale: boolean;
  marketStatus: MarketStatus;
  reason: string | null;
};

export type ProviderAdapter = {
  provider: ProviderName;
  assetClass: AssetClass;
  fetchQuote: (symbol: string) => Promise<QuoteResult>;
  fetchCandles: (symbol: string, timeframe: Timeframe) => Promise<CandleResult>;
};

export type ProviderSelection = {
  primary: ProviderAdapter | null;
  fallbacks: ProviderAdapter[];
};

export type OrchestratedQuote = QuoteResult & {
  selectedProvider: ProviderName | null;
  fallbackUsed: boolean;
  freshnessMs: number | null;
  fromCache: boolean;
  circuitState: string | null;
};

export type OrchestratedCandles = CandleResult & {
  selectedProvider: ProviderName | null;
  fallbackUsed: boolean;
  freshnessMs: number | null;
  fromCache: boolean;
  circuitState: string | null;
};
