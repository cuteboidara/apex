import { MTF_ANALYSIS_MIN_CANDLES, type MTFCandles } from "@/src/assets/shared/mtfAnalysis";
import type { Candle } from "@/src/assets/shared/types";
import {
  getCoinGeckoIdForSymbol,
  getCryptoShortSymbol,
} from "@/src/crypto/config/cryptoScope";
import { canonicalizeMarketSymbol } from "@/src/lib/marketSymbols";
import { resolveYahooSymbol } from "@/src/lib/yahooFinance";

const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
] as const;

const REQUEST_TIMEOUT_MS = 8_000;
const BINANCE_REST_BASE = "https://api.binance.com/api/v3";
const BYBIT_REST_BASE = "https://api.bybit.com/v5/market";
const COINGECKO_REST_BASE = "https://api.coingecko.com/api/v3";
const CRYPTOCOMPARE_REST_BASE = "https://min-api.cryptocompare.com/data/v2";

type CryptoProviderName = "binance" | "bybit" | "coingecko" | "cryptocompare" | "yahoo";
type TimeframeKey = "daily" | "h4" | "h1" | "m15" | "m5";
type DirectCryptoFrames = Record<TimeframeKey, Candle[]>;

export type MTFCandleEnvelope = MTFCandles & {
  requestedSymbol: string;
  sourceProvider: string;
  providerPath: string[];
  providerErrors: string[];
};

const globalForCoinGecko = globalThis as typeof globalThis & {
  __apexCoinGeckoIdCache?: Map<string, string | null>;
};

const coinGeckoIdCache = globalForCoinGecko.__apexCoinGeckoIdCache ??= new Map<string, string | null>();

const FALLBACK_SYMBOL_MAP: Record<string, string> = {
  XAUUSD: "GC=F",
  XAGUSD: "SI=F",
  USDJPY: "JPY=X",
  USDCAD: "CAD=X",
  USDCHF: "CHF=X",
  BTCUSDT: "BTC-USD",
  ETHUSDT: "ETH-USD",
  SOLUSDT: "SOL-USD",
  BNBUSDT: "BNB-USD",
  XRPUSDT: "XRP-USD",
  DOGEUSDT: "DOGE-USD",
  ADAUSDT: "ADA-USD",
  AVAXUSDT: "AVAX-USD",
};

function normalizeApexSymbol(symbol: string): string {
  return canonicalizeMarketSymbol(symbol) ?? symbol.trim().toUpperCase();
}

function toYahooSymbol(symbol: string): string | null {
  const normalized = normalizeApexSymbol(symbol);
  if (FALLBACK_SYMBOL_MAP[normalized]) {
    return FALLBACK_SYMBOL_MAP[normalized];
  }

  if (/^[A-Z0-9]{2,15}USDT$/.test(normalized)) {
    return `${normalized.slice(0, -4)}-USD`;
  }

  return resolveYahooSymbol(normalized);
}

function isCryptoMtfSymbol(symbol: string): boolean {
  return normalizeApexSymbol(symbol).endsWith("USDT");
}

function buildTimeoutController(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear: () => clearTimeout(timeout),
  };
}

async function fetchJsonWithTimeout<T>(input: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const { controller, clear } = buildTimeoutController(timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }

    return await response.json() as T;
  } finally {
    clear();
  }
}

async function fetchTextWithTimeout(input: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<string> {
  const { controller, clear } = buildTimeoutController(timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }

    return await response.text();
  } finally {
    clear();
  }
}

function isValidCandle(candle: Candle): boolean {
  return Number.isFinite(candle.time)
    && candle.time > 0
    && Number.isFinite(candle.open)
    && candle.open > 0
    && Number.isFinite(candle.high)
    && candle.high > 0
    && Number.isFinite(candle.low)
    && candle.low > 0
    && Number.isFinite(candle.close)
    && candle.close > 0;
}

function sortCandlesAscending(candles: Candle[]): Candle[] {
  return [...candles]
    .filter(isValidCandle)
    .sort((left, right) => left.time - right.time);
}

function aggregateCandles(candles: Candle[], bucketMs: number): Candle[] {
  if (candles.length === 0) {
    return [];
  }

  const grouped = new Map<number, Candle[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.time / bucketMs) * bucketMs;
    if (!grouped.has(bucket)) {
      grouped.set(bucket, []);
    }
    grouped.get(bucket)?.push(candle);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucket, group]) => ({
      time: bucket,
      open: group[0]?.open ?? group[0]?.close ?? 0,
      high: Math.max(...group.map(candle => candle.high)),
      low: Math.min(...group.map(candle => candle.low)),
      close: group.at(-1)?.close ?? group[0]?.close ?? 0,
      volume: group.reduce((sum, candle) => sum + (candle.volume ?? 0), 0),
    }))
    .filter(isValidCandle);
}

function aggregatePricePoints(points: Array<{ time: number; price: number }>, bucketMs: number): Candle[] {
  const grouped = new Map<number, Array<{ time: number; price: number }>>();
  for (const point of points) {
    if (!Number.isFinite(point.time) || point.time <= 0 || !Number.isFinite(point.price) || point.price <= 0) {
      continue;
    }
    const bucket = Math.floor(point.time / bucketMs) * bucketMs;
    if (!grouped.has(bucket)) {
      grouped.set(bucket, []);
    }
    grouped.get(bucket)?.push(point);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucket, group]) => ({
      time: bucket,
      open: group[0]?.price ?? 0,
      high: Math.max(...group.map(point => point.price)),
      low: Math.min(...group.map(point => point.price)),
      close: group.at(-1)?.price ?? 0,
      volume: 0,
    }))
    .filter(isValidCandle);
}

function buildEnvelope(input: {
  symbol: string;
  provider: string;
  providerPath: string[];
  providerErrors: string[];
  directFrames: DirectCryptoFrames;
}): MTFCandleEnvelope {
  const daily = sortCandlesAscending(input.directFrames.daily);
  const h4 = sortCandlesAscending(input.directFrames.h4);
  const h1 = sortCandlesAscending(input.directFrames.h1);
  const m15 = sortCandlesAscending(input.directFrames.m15);
  const m5 = sortCandlesAscending(input.directFrames.m5);

  return {
    requestedSymbol: input.symbol,
    sourceProvider: input.provider,
    providerPath: [...input.providerPath],
    providerErrors: [...input.providerErrors],
    monthly: aggregateCandles(daily, 30 * 24 * 60 * 60 * 1000),
    weekly: aggregateCandles(daily, 7 * 24 * 60 * 60 * 1000),
    daily,
    h4,
    h1,
    m15,
    m5,
  };
}

function missingTimeframeCounts(frames: DirectCryptoFrames): string[] {
  const issues: string[] = [];
  if (frames.daily.length < MTF_ANALYSIS_MIN_CANDLES.daily) issues.push(`daily=${frames.daily.length}`);
  if (frames.h4.length < MTF_ANALYSIS_MIN_CANDLES.h4) issues.push(`h4=${frames.h4.length}`);
  if (frames.h1.length < MTF_ANALYSIS_MIN_CANDLES.h1) issues.push(`h1=${frames.h1.length}`);
  if (frames.m15.length < MTF_ANALYSIS_MIN_CANDLES.m15) issues.push(`m15=${frames.m15.length}`);
  if (frames.m5.length < MTF_ANALYSIS_MIN_CANDLES.m5) issues.push(`m5=${frames.m5.length}`);
  return issues;
}

function ensureFrameCounts(provider: CryptoProviderName, frames: DirectCryptoFrames): DirectCryptoFrames {
  const issues = missingTimeframeCounts(frames);
  if (issues.length > 0) {
    throw new Error(`${provider}_insufficient_${issues.join(",")}`);
  }
  return frames;
}

function logCryptoMtfSuccess(bundle: MTFCandleEnvelope): void {
  console.log(
    `[MTF] ${bundle.requestedSymbol}: provider=${bundle.sourceProvider} path=${bundle.providerPath.join("->")} d=${bundle.daily.length} h4=${bundle.h4.length} h1=${bundle.h1.length} m15=${bundle.m15.length} m5=${bundle.m5.length}`,
  );
}

async function fetchYahooTF(
  symbol: string,
  interval: string,
  range: string,
): Promise<Candle[]> {
  const yahooSymbol = toYahooSymbol(symbol);
  if (!yahooSymbol) {
    return [];
  }

  for (const host of YAHOO_HOSTS) {
    try {
      const payload = await fetchJsonWithTimeout<{
        chart?: {
          result?: Array<{
            timestamp?: Array<number | null>;
            indicators?: {
              quote?: Array<{
                open?: Array<number | null>;
                high?: Array<number | null>;
                low?: Array<number | null>;
                close?: Array<number | null>;
                volume?: Array<number | null>;
              }>;
            };
          }> | null;
        };
      }>(
        `${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}&includePrePost=false`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
          },
        },
      );

      const result = payload.chart?.result?.[0];
      const timestamps = result?.timestamp ?? [];
      const quote = result?.indicators?.quote?.[0];
      if (!quote || timestamps.length === 0) {
        continue;
      }

      const candles: Candle[] = [];
      for (let index = 0; index < timestamps.length; index += 1) {
        const timestamp = timestamps[index];
        const open = quote.open?.[index];
        const high = quote.high?.[index];
        const low = quote.low?.[index];
        const close = quote.close?.[index];
        const volume = quote.volume?.[index];
        if (
          timestamp == null
          || open == null
          || high == null
          || low == null
          || close == null
        ) {
          continue;
        }

        candles.push({
          time: timestamp * 1000,
          open,
          high,
          low,
          close,
          volume: typeof volume === "number" && Number.isFinite(volume) ? volume : 0,
        });
      }

      if (candles.length > 0) {
        return sortCandlesAscending(candles);
      }
    } catch {
      continue;
    }
  }

  return [];
}

async function fetchBinanceFrames(symbol: string): Promise<DirectCryptoFrames> {
  const normalizedSymbol = normalizeApexSymbol(symbol);
  const fetchInterval = async (interval: string, limit: number): Promise<Candle[]> => {
    const payload = await fetchJsonWithTimeout<unknown[][]>(
      `${BINANCE_REST_BASE}/klines?symbol=${encodeURIComponent(normalizedSymbol)}&interval=${interval}&limit=${limit}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    return sortCandlesAscending(payload.map(row => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    })));
  };

  const [daily, h4, h1, m15, m5] = await Promise.all([
    fetchInterval("1d", 180),
    fetchInterval("4h", 180),
    fetchInterval("1h", 240),
    fetchInterval("15m", 240),
    fetchInterval("5m", 240),
  ]);

  return ensureFrameCounts("binance", { daily, h4, h1, m15, m5 });
}

async function fetchBybitFrames(symbol: string): Promise<DirectCryptoFrames> {
  const normalizedSymbol = normalizeApexSymbol(symbol);
  const fetchInterval = async (interval: string, limit: number): Promise<Candle[]> => {
    const payload = await fetchJsonWithTimeout<{
      retCode?: number;
      retMsg?: string;
      result?: {
        list?: Array<Array<string | number>>;
      };
    }>(
      `${BYBIT_REST_BASE}/kline?category=spot&symbol=${encodeURIComponent(normalizedSymbol)}&interval=${interval}&limit=${limit}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    if (payload.retCode !== 0) {
      throw new Error(payload.retMsg || "bybit_ret_code");
    }

    const rows = payload.result?.list ?? [];
    return sortCandlesAscending(rows.map(row => ({
      time: Number(row[0]),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    })));
  };

  const [daily, h4, h1, m15, m5] = await Promise.all([
    fetchInterval("D", 180),
    fetchInterval("240", 180),
    fetchInterval("60", 240),
    fetchInterval("15", 240),
    fetchInterval("5", 240),
  ]);

  return ensureFrameCounts("bybit", { daily, h4, h1, m15, m5 });
}

async function resolveCoinGeckoId(symbol: string): Promise<string | null> {
  const normalized = normalizeApexSymbol(symbol);
  if (coinGeckoIdCache.has(normalized)) {
    return coinGeckoIdCache.get(normalized) ?? null;
  }

  const known = getCoinGeckoIdForSymbol(normalized);
  if (known) {
    coinGeckoIdCache.set(normalized, known);
    return known;
  }

  try {
    const query = getCryptoShortSymbol(normalized).toLowerCase();
    const payload = await fetchJsonWithTimeout<{
      coins?: Array<{
        id?: string;
        symbol?: string;
      }>;
    }>(
      `${COINGECKO_REST_BASE}/search?query=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    const match = payload.coins?.find(coin => coin.symbol?.toLowerCase() === query);
    const resolved = match?.id ?? null;
    coinGeckoIdCache.set(normalized, resolved);
    return resolved;
  } catch {
    coinGeckoIdCache.set(normalized, null);
    return null;
  }
}

async function fetchCoinGeckoPoints(coinGeckoId: string, days: number): Promise<Array<{ time: number; price: number }>> {
  const payload = await fetchJsonWithTimeout<{
    prices?: Array<[number, number]>;
  }>(
    `${COINGECKO_REST_BASE}/coins/${encodeURIComponent(coinGeckoId)}/market_chart?vs_currency=usd&days=${days}`,
    {
      headers: {
        Accept: "application/json",
      },
    },
  );

  return (payload.prices ?? [])
    .map(([time, price]) => ({ time, price }))
    .filter(point => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0)
    .sort((left, right) => left.time - right.time);
}

async function fetchCoinGeckoFrames(symbol: string): Promise<DirectCryptoFrames> {
  const coinGeckoId = await resolveCoinGeckoId(symbol);
  if (!coinGeckoId) {
    throw new Error("coingecko_symbol_unresolved");
  }

  const [dailyPoints, h4Points, h1Points, intradayPoints] = await Promise.all([
    fetchCoinGeckoPoints(coinGeckoId, 180),
    fetchCoinGeckoPoints(coinGeckoId, 30),
    fetchCoinGeckoPoints(coinGeckoId, 7),
    fetchCoinGeckoPoints(coinGeckoId, 1),
  ]);

  return ensureFrameCounts("coingecko", {
    daily: aggregatePricePoints(dailyPoints, 24 * 60 * 60 * 1000),
    h4: aggregatePricePoints(h4Points, 4 * 60 * 60 * 1000),
    h1: aggregatePricePoints(h1Points, 60 * 60 * 1000),
    m15: aggregatePricePoints(intradayPoints, 15 * 60 * 1000),
    m5: aggregatePricePoints(intradayPoints, 5 * 60 * 1000),
  });
}

async function fetchYahooCryptoFrames(symbol: string): Promise<DirectCryptoFrames> {
  const [daily, h1, m15, m5] = await Promise.all([
    fetchYahooTF(symbol, "1d", "6mo"),
    fetchYahooTF(symbol, "1h", "30d"),
    fetchYahooTF(symbol, "15m", "8d"),
    fetchYahooTF(symbol, "5m", "5d"),
  ]);

  return ensureFrameCounts("yahoo", {
    daily,
    h4: aggregateCandles(h1, 4 * 60 * 60 * 1000),
    h1,
    m15,
    m5,
  });
}

async function fetchCryptoCompareSeries(
  path: string,
  params: Record<string, string | number>,
): Promise<Candle[]> {
  const url = new URL(`${CRYPTOCOMPARE_REST_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  const payload = await fetchJsonWithTimeout<{
    Response?: string;
    Message?: string;
    Data?: {
      Data?: Array<{
        time?: number;
        open?: number;
        high?: number;
        low?: number;
        close?: number;
        volumeto?: number;
      }>;
    };
  }>(
    url.toString(),
    {
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (payload.Response && payload.Response !== "Success") {
    throw new Error(payload.Message || "cryptocompare_response");
  }

  return sortCandlesAscending((payload.Data?.Data ?? []).map(row => ({
    time: Number(row.time) * 1000,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volumeto),
  })));
}

async function fetchCryptoCompareFrames(symbol: string): Promise<DirectCryptoFrames> {
  const base = getCryptoShortSymbol(symbol);

  const [daily, h4, h1, m15, m5] = await Promise.all([
    fetchCryptoCompareSeries("histoday", { fsym: base, tsym: "USD", limit: 180 }),
    fetchCryptoCompareSeries("histohour", { fsym: base, tsym: "USD", limit: 180, aggregate: 4 }),
    fetchCryptoCompareSeries("histohour", { fsym: base, tsym: "USD", limit: 240 }),
    fetchCryptoCompareSeries("histominute", { fsym: base, tsym: "USD", limit: 240, aggregate: 15 }),
    fetchCryptoCompareSeries("histominute", { fsym: base, tsym: "USD", limit: 240, aggregate: 5 }),
  ]);

  return ensureFrameCounts("cryptocompare", { daily, h4, h1, m15, m5 });
}

export async function fetchMTFCandles(
  symbol: string,
): Promise<MTFCandles & Partial<{ requestedSymbol: string; sourceProvider: string; providerPath: string[]; providerErrors: string[] }>> {
  const normalizedSymbol = normalizeApexSymbol(symbol);

  if (isCryptoMtfSymbol(normalizedSymbol)) {
    const providerPath: string[] = [];
    const providerErrors: string[] = [];
    const providers: Array<{ name: CryptoProviderName; fetcher: (asset: string) => Promise<DirectCryptoFrames> }> = [
      { name: "binance", fetcher: fetchBinanceFrames },
      { name: "bybit", fetcher: fetchBybitFrames },
      { name: "coingecko", fetcher: fetchCoinGeckoFrames },
      { name: "cryptocompare", fetcher: fetchCryptoCompareFrames },
      { name: "yahoo", fetcher: fetchYahooCryptoFrames },
    ];

    for (const provider of providers) {
      providerPath.push(provider.name);
      try {
        const directFrames = await provider.fetcher(normalizedSymbol);
        const bundle = buildEnvelope({
          symbol: normalizedSymbol,
          provider: provider.name,
          providerPath,
          providerErrors,
          directFrames,
        });
        logCryptoMtfSuccess(bundle);
        return bundle;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        providerErrors.push(`${provider.name}:${message}`);
      }
    }

    console.error(`[MTF] ${normalizedSymbol}: all crypto candle providers failed`, providerErrors);
    throw new Error(`[MTF] ${normalizedSymbol}: no crypto provider returned enough candles (${providerErrors.join(" | ")})`);
  }

  const [monthly, weekly, daily, h1, m15, m5] = await Promise.all([
    fetchYahooTF(normalizedSymbol, "1mo", "5y"),
    fetchYahooTF(normalizedSymbol, "1wk", "2y"),
    fetchYahooTF(normalizedSymbol, "1d", "6mo"),
    fetchYahooTF(normalizedSymbol, "1h", "30d"),
    fetchYahooTF(normalizedSymbol, "15m", "8d"),
    fetchYahooTF(normalizedSymbol, "5m", "5d"),
  ]);

  const h4 = aggregateCandles(h1, 4 * 60 * 60 * 1000);
  const bundle: MTFCandleEnvelope = {
    requestedSymbol: normalizedSymbol,
    sourceProvider: "yahoo",
    providerPath: ["yahoo"],
    providerErrors: [],
    monthly,
    weekly,
    daily,
    h4,
    h1,
    m15,
    m5,
  };

  console.log(
    `[MTF] ${normalizedSymbol}: provider=yahoo mo=${monthly.length} wk=${weekly.length} d=${daily.length} h4=${h4.length} h1=${h1.length} m15=${m15.length} m5=${m5.length}`,
  );

  return bundle;
}

export async function fetchYahooCandlePreview(symbol: string): Promise<string> {
  const yahooSymbol = toYahooSymbol(symbol);
  if (!yahooSymbol) {
    return "";
  }

  return fetchTextWithTimeout(
    `${YAHOO_HOSTS[0]}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d&includePrePost=false`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "application/json",
      },
    },
  );
}
