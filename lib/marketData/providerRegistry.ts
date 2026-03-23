import { getAlphaVantageForexQuote, getAlphaVantageMetalQuote } from "@/lib/providers/alphaVantage";
import { getFcsCandles, getFcsQuote } from "@/lib/providers/fcs";
import type { AssetClass, CandleResult, ProviderAdapter, QuoteResult, Timeframe } from "@/lib/marketData/types";
// Note: FCS API is only used as a CRYPTO fallback. Yahoo Finance is the sole
// provider for FOREX and COMMODITY assets — those classes bypass the orchestrators
// entirely via fetchMultiProviderAsset / getAssetPrice in lib/marketData.ts.

const BINANCE_BASE = "https://api.binance.com/api/v3";

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

async function fetchFcsMarketQuote(symbol: string, assetClass: AssetClass): Promise<QuoteResult> {
  const quote = await getFcsQuote(symbol);
  return {
    symbol,
    assetClass,
    provider: "FCS API",
    price: quote.price,
    change24h: quote.change24h,
    high14d: quote.high14d,
    low14d: quote.low14d,
    volume: quote.volume,
    timestamp: quote.timestamp,
    stale: quote.stale,
    marketStatus: quote.marketStatus,
    reason: quote.reason,
  };
}

async function fetchFcsMarketCandles(symbol: string, assetClass: AssetClass, timeframe: Timeframe): Promise<CandleResult> {
  const candles = await getFcsCandles(symbol, timeframe);
  return {
    symbol,
    assetClass,
    provider: "FCS API",
    timeframe,
    candles: candles.candles,
    timestamp: candles.timestamp,
    stale: candles.stale,
    marketStatus: candles.marketStatus,
    reason: candles.reason,
  };
}

async function fetchAlphaQuote(symbol: string, assetClass: AssetClass): Promise<QuoteResult> {
  const normalized = assetClass === "FOREX"
    ? await getAlphaVantageForexQuote(symbol as "EURUSD" | "GBPUSD" | "USDJPY")
    : await getAlphaVantageMetalQuote(symbol as "XAUUSD" | "XAGUSD");
  return {
    symbol,
    assetClass,
    provider: "Alpha Vantage",
    price: normalized.price,
    change24h: normalized.change24h,
    high14d: normalized.high14d,
    low14d: normalized.low14d,
    volume: null,
    timestamp: normalized.timestamp,
    stale: normalized.stale,
    marketStatus: normalized.marketStatus,
    reason: normalized.reason,
    closes: normalized.closes,
  };
}

async function fetchAlphaCandles(symbol: string, assetClass: AssetClass, timeframe: Timeframe): Promise<CandleResult> {
  return {
    symbol,
    assetClass,
    provider: "Alpha Vantage",
    timeframe,
    candles: [],
    timestamp: null,
    stale: true,
    marketStatus: "UNAVAILABLE",
    reason: `Alpha Vantage does not provide usable ${timeframe} candles in this fallback path.`,
  };
}

export const providerRegistry: Record<AssetClass, ProviderAdapter[]> = {
  CRYPTO: [
    {
      provider: "Binance",
      assetClass: "CRYPTO",
      fetchQuote: fetchBinanceQuote,
      fetchCandles: fetchBinanceCandles,
    },
    {
      provider: "FCS API",
      assetClass: "CRYPTO",
      fetchQuote: symbol => fetchFcsMarketQuote(symbol, "CRYPTO"),
      fetchCandles: (symbol, timeframe) => fetchFcsMarketCandles(symbol, "CRYPTO", timeframe),
    },
  ],
  // Yahoo Finance is the sole provider for FOREX and COMMODITY — these registries
  // are kept minimal (Alpha Vantage only, last-resort) since the main data paths
  // (fetchMultiProviderAsset and getAssetPrice) call Yahoo Finance directly and
  // never go through the orchestrators for these classes.
  FOREX: [
    {
      provider: "Alpha Vantage",
      assetClass: "FOREX",
      fetchQuote: symbol => fetchAlphaQuote(symbol, "FOREX"),
      fetchCandles: (symbol, timeframe) => fetchAlphaCandles(symbol, "FOREX", timeframe),
    },
  ],
  COMMODITY: [
    {
      provider: "Alpha Vantage",
      assetClass: "COMMODITY",
      fetchQuote: symbol => fetchAlphaQuote(symbol, "COMMODITY"),
      fetchCandles: (symbol, timeframe) => fetchAlphaCandles(symbol, "COMMODITY", timeframe),
    },
  ],
};
