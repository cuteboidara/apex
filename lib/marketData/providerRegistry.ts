import type { AssetClass, CandleResult, ProviderAdapter, QuoteResult, Timeframe } from "@/lib/marketData/types";
import { fetchYahooCandles, fetchYahooPrice } from "@/lib/providers/yahooFinance";
import type { ProviderAdapterV2, ProviderCandlePayload, ProviderQuotePayload } from "@/lib/providers/types";

const BINANCE_BASE = "https://api.binance.com/api/v3";
const ALL_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1D"];

function toPositiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

async function fetchBinanceQuote(symbol: string): Promise<QuoteResult> {
  try {
    const res = await fetch(`${BINANCE_BASE}/ticker/24hr?symbol=${symbol}`, { cache: "no-store" });
    if (!res.ok) {
      return {
        symbol,
        assetClass: "CRYPTO",
        provider: "Binance",
        price: null,
        change24h: null,
        high14d: null,
        low14d: null,
        volume: null,
        timestamp: null,
        stale: true,
        marketStatus: "UNAVAILABLE",
        reason: `HTTP ${res.status}`,
      };
    }

    const raw = await res.json() as Record<string, string>;
    const price = toPositiveNumber(raw.lastPrice);
    return {
      symbol,
      assetClass: "CRYPTO",
      provider: "Binance",
      price,
      change24h: Number(raw.priceChangePercent ?? "0") || null,
      high14d: Number(raw.highPrice ?? "0") || null,
      low14d: Number(raw.lowPrice ?? "0") || null,
      volume: Number(raw.volume ?? "0") || null,
      timestamp: Date.now(),
      stale: price == null,
      marketStatus: price != null ? "LIVE" : "DEGRADED",
      reason: price != null ? null : "Invalid Binance payload.",
    };
  } catch (error) {
    return {
      symbol,
      assetClass: "CRYPTO",
      provider: "Binance",
      price: null,
      change24h: null,
      high14d: null,
      low14d: null,
      volume: null,
      timestamp: null,
      stale: true,
      marketStatus: "UNAVAILABLE",
      reason: String(error),
    };
  }
}

async function fetchBinanceProviderQuote(symbol: string): Promise<ProviderQuotePayload> {
  return fetchBinanceQuote(symbol);
}

async function fetchBinanceCandles(symbol: string, timeframe: Timeframe): Promise<CandleResult> {
  const intervalMap: Record<Timeframe, string> = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1h",
    "4h": "4h",
    "1D": "1d",
  };

  try {
    const res = await fetch(`${BINANCE_BASE}/klines?symbol=${symbol}&interval=${intervalMap[timeframe]}&limit=50`, { cache: "no-store" });
    if (!res.ok) {
      return {
        symbol,
        assetClass: "CRYPTO",
        provider: "Binance",
        timeframe,
        candles: [],
        timestamp: null,
        stale: true,
        marketStatus: "UNAVAILABLE",
        reason: `HTTP ${res.status}`,
      };
    }

    const rows = await res.json() as Array<[number, string, string, string, string, string]>;
    const candles = rows.map(row => ({
      timestamp: row[0],
      open: toPositiveNumber(row[1]),
      high: toPositiveNumber(row[2]),
      low: toPositiveNumber(row[3]),
      close: toPositiveNumber(row[4]),
      volume: Number(row[5]) || null,
    }));

    return {
      symbol,
      assetClass: "CRYPTO",
      provider: "Binance",
      timeframe,
      candles,
      timestamp: candles.at(-1)?.timestamp ?? null,
      stale: candles.length === 0,
      marketStatus: candles.length > 0 ? "LIVE" : "DEGRADED",
      reason: candles.length > 0 ? null : "No Binance candles.",
    };
  } catch (error) {
    return {
      symbol,
      assetClass: "CRYPTO",
      provider: "Binance",
      timeframe,
      candles: [],
      timestamp: null,
      stale: true,
      marketStatus: "UNAVAILABLE",
      reason: String(error),
    };
  }
}

async function fetchBinanceProviderCandles(symbol: string, timeframe: Timeframe): Promise<ProviderCandlePayload> {
  return fetchBinanceCandles(symbol, timeframe);
}

async function fetchYahooProviderQuote(symbol: string, assetClass: AssetClass): Promise<ProviderQuotePayload> {
  const yahoo = await fetchYahooPrice(symbol);
  return {
    symbol,
    assetClass,
    provider: "Yahoo Finance",
    price: yahoo.price,
    change24h: yahoo.change24h,
    high14d: yahoo.high14d,
    low14d: yahoo.low14d,
    volume: null,
    timestamp: Date.now(),
    stale: yahoo.price == null,
    marketStatus: yahoo.price != null ? "LIVE" : "DEGRADED",
    reason: yahoo.price != null ? null : "Yahoo Finance quote unavailable.",
    closes: yahoo.closes,
    requestSymbol: symbol,
    sourceTimestamp: Date.now(),
    metadata: null,
  };
}

async function fetchYahooProviderCandles(symbol: string, assetClass: AssetClass, timeframe: Timeframe): Promise<ProviderCandlePayload> {
  const yahoo = await fetchYahooCandles(symbol, timeframe);
  return {
    symbol,
    assetClass,
    provider: "Yahoo Finance",
    timeframe,
    candles: yahoo.candles.map(candle => ({
      ...candle,
      sourceTimestamp: candle.timestamp,
    })),
    timestamp: yahoo.candles.at(-1)?.timestamp ?? null,
    stale: yahoo.stale,
    marketStatus: yahoo.marketStatus,
    reason: yahoo.reason,
    requestSymbol: symbol,
    metadata: null,
  };
}

export const marketProviderCatalog: ProviderAdapterV2[] = [
  {
    provider: "Binance",
    capability: {
      provider: "Binance",
      assetClasses: ["CRYPTO"],
      timeframes: ALL_TIMEFRAMES,
      supportsQuotes: true,
      supportsHistoricalBackfill: true,
      supportsIntraday: true,
      degradedFallback: false,
      primaryPriority: 100,
      description: "Primary crypto quotes and candles.",
    },
    supportsSymbol: (_symbol, assetClass) => assetClass === "CRYPTO",
    fetchQuote: symbol => fetchBinanceProviderQuote(symbol),
    fetchCandles: (symbol, _assetClass, timeframe) => fetchBinanceProviderCandles(symbol, timeframe),
  },
  {
    provider: "Yahoo Finance",
    capability: {
      provider: "Yahoo Finance",
      assetClasses: ["FOREX", "COMMODITY"],
      timeframes: ALL_TIMEFRAMES,
      supportsQuotes: true,
      supportsHistoricalBackfill: true,
      supportsIntraday: true,
      degradedFallback: false,
      primaryPriority: 90,
      description: "Primary FX/metals quotes and candles.",
    },
    supportsSymbol: (_symbol, assetClass) => assetClass === "FOREX" || assetClass === "COMMODITY",
    fetchQuote: (symbol, assetClass) => fetchYahooProviderQuote(symbol, assetClass),
    fetchCandles: (symbol, assetClass, timeframe) => fetchYahooProviderCandles(symbol, assetClass, timeframe),
  },
];

function toLegacyAdapter(adapter: ProviderAdapterV2, assetClass: AssetClass): ProviderAdapter {
  return {
    provider: adapter.provider,
    assetClass,
    fetchQuote: symbol => adapter.fetchQuote(symbol, assetClass) as Promise<QuoteResult>,
    fetchCandles: (symbol, timeframe) => adapter.fetchCandles(symbol, assetClass, timeframe) as Promise<CandleResult>,
  };
}

export function getProviderAdaptersForAsset(assetClass: AssetClass, timeframe?: Timeframe) {
  return marketProviderCatalog
    .filter(adapter => adapter.capability.assetClasses.includes(assetClass))
    .filter(adapter => timeframe == null || adapter.capability.timeframes.includes(timeframe))
    .sort((left, right) => right.capability.primaryPriority - left.capability.primaryPriority);
}

export const providerRegistry: Record<AssetClass, ProviderAdapter[]> = {
  CRYPTO: getProviderAdaptersForAsset("CRYPTO").map(adapter => toLegacyAdapter(adapter, "CRYPTO")),
  FOREX: getProviderAdaptersForAsset("FOREX").map(adapter => toLegacyAdapter(adapter, "FOREX")),
  COMMODITY: getProviderAdaptersForAsset("COMMODITY").map(adapter => toLegacyAdapter(adapter, "COMMODITY")),
};
