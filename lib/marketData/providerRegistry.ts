import { getAlphaVantageForexQuote, getAlphaVantageMetalQuote } from "@/lib/providers/alphaVantage";
import { getTwelveDataQuote, getTwelveDataTimeSeries } from "@/lib/providers/twelveData";
import type { AssetClass, CandleResult, ProviderAdapter, QuoteResult, Timeframe } from "@/lib/marketData/types";

const BINANCE_BASE = "https://api.binance.com/api/v3";

function toPositiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function candleTimestampFromSeriesDate(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value.includes("T") ? value : `${value} UTC`);
  return Number.isFinite(parsed) ? parsed : null;
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
      return { symbol, assetClass: "CRYPTO", provider: "Binance", timeframe, candles: [], timestamp: null, stale: true, marketStatus: "UNAVAILABLE", reason: `HTTP ${res.status}` };
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
    return { symbol, assetClass: "CRYPTO", provider: "Binance", timeframe, candles: [], timestamp: null, stale: true, marketStatus: "UNAVAILABLE", reason: String(error) };
  }
}

async function fetchTwelveQuote(symbol: string, assetClass: AssetClass): Promise<QuoteResult> {
  const quote = await getTwelveDataQuote(symbol);
  return {
    symbol,
    assetClass,
    provider: "Twelve Data",
    price: quote?.price ?? null,
    change24h: null,
    high14d: null,
    low14d: null,
    volume: null,
    timestamp: quote?.timestamp ?? null,
    stale: quote == null,
    marketStatus: quote ? "LIVE" : "UNAVAILABLE",
    reason: quote ? null : "Twelve Data quote unavailable.",
  };
}

async function fetchTwelveCandles(symbol: string, assetClass: AssetClass, timeframe: Timeframe): Promise<CandleResult> {
  const intervalMap: Record<Timeframe, string> = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "1h": "1h",
    "4h": "4h",
    "1D": "1day",
  };
  const values = await getTwelveDataTimeSeries(symbol, 50, intervalMap[timeframe]);
  const candles = (values ?? []).map(point => ({
    timestamp: candleTimestampFromSeriesDate(point.datetime ?? point.datetime),
    open: toPositiveNumber(point.open),
    high: toPositiveNumber(point.high),
    low: toPositiveNumber(point.low),
    close: toPositiveNumber(point.close),
    volume: toPositiveNumber(point.volume),
  })).filter(point => point.timestamp != null) as Array<{ timestamp: number; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null }>;
  return {
    symbol,
    assetClass,
    provider: "Twelve Data",
    timeframe,
    candles,
    timestamp: candles[0]?.timestamp ?? null,
    stale: candles.length === 0,
    marketStatus: candles.length > 0 ? "LIVE" : "UNAVAILABLE",
    reason: candles.length > 0 ? null : "Twelve Data candles unavailable.",
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
    { provider: "Binance", assetClass: "CRYPTO", fetchQuote: fetchBinanceQuote, fetchCandles: fetchBinanceCandles },
    { provider: "Twelve Data", assetClass: "CRYPTO", fetchQuote: symbol => fetchTwelveQuote(symbol, "CRYPTO"), fetchCandles: (symbol, timeframe) => fetchTwelveCandles(symbol, "CRYPTO", timeframe) },
  ],
  FOREX: [
    { provider: "Twelve Data", assetClass: "FOREX", fetchQuote: symbol => fetchTwelveQuote(symbol, "FOREX"), fetchCandles: (symbol, timeframe) => fetchTwelveCandles(symbol, "FOREX", timeframe) },
    { provider: "Alpha Vantage", assetClass: "FOREX", fetchQuote: symbol => fetchAlphaQuote(symbol, "FOREX"), fetchCandles: (symbol, timeframe) => fetchAlphaCandles(symbol, "FOREX", timeframe) },
  ],
  COMMODITY: [
    { provider: "Twelve Data", assetClass: "COMMODITY", fetchQuote: symbol => fetchTwelveQuote(symbol, "COMMODITY"), fetchCandles: (symbol, timeframe) => fetchTwelveCandles(symbol, "COMMODITY", timeframe) },
    { provider: "Alpha Vantage", assetClass: "COMMODITY", fetchQuote: symbol => fetchAlphaQuote(symbol, "COMMODITY"), fetchCandles: (symbol, timeframe) => fetchAlphaCandles(symbol, "COMMODITY", timeframe) },
  ],
};
