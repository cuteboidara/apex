import type {
  AssetClass,
  CandleBar,
  CandleResult,
  OrchestratedCandles,
  OrchestratedQuote,
  ProviderName,
  QuoteResult,
  Timeframe,
} from "@/lib/marketData/types";

export type ProviderCapability = {
  provider: ProviderName;
  assetClasses: AssetClass[];
  timeframes: Timeframe[];
  supportsQuotes: boolean;
  supportsHistoricalBackfill: boolean;
  supportsIntraday: boolean;
  degradedFallback: boolean;
  primaryPriority: number;
  envVar?: string;
  description: string;
};

export type ProviderQuotePayload = QuoteResult & {
  requestSymbol?: string | null;
  sourceTimestamp?: number | null;
  receivedAt?: number | null;
  bid?: number | null;
  ask?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type ProviderCandleBar = CandleBar & {
  sourceTimestamp?: number | null;
};

export type ProviderCandlePayload = CandleResult & {
  candles: ProviderCandleBar[];
  requestSymbol?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ProviderAdapterV2 = {
  provider: ProviderName;
  capability: ProviderCapability;
  supportsSymbol: (symbol: string, assetClass: AssetClass) => boolean;
  fetchQuote: (symbol: string, assetClass: AssetClass) => Promise<ProviderQuotePayload>;
  fetchCandles: (symbol: string, assetClass: AssetClass, timeframe: Timeframe) => Promise<ProviderCandlePayload>;
};

export type RoutedMarketQuote = OrchestratedQuote & {
  requestSymbol?: string | null;
  bid?: number | null;
  ask?: number | null;
  metadata?: Record<string, unknown> | null;
};

export type RoutedMarketCandles = OrchestratedCandles & {
  requestSymbol?: string | null;
  metadata?: Record<string, unknown> | null;
};
