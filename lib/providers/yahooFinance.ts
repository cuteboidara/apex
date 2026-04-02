import { recordProviderHealth } from "@/lib/providerHealth";
import { canonicalizeMarketSymbol } from "@/src/lib/marketSymbols";

// Try query2 when query1 is blocked (common on cloud/Railway IPs)
const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
];
const REQUEST_TIMEOUT_MS = 8000;

export const YAHOO_SYMBOL_MAP: Record<string, string> = {
  EURUSD:  "EURUSD=X",
  GBPUSD:  "GBPUSD=X",
  USDJPY:  "USDJPY=X",
  USDCAD:  "CAD=X",
  AUDUSD:  "AUDUSD=X",
  NZDUSD:  "NZDUSD=X",
  USDCHF:  "CHF=X",
  EURJPY:  "EURJPY=X",
  GBPJPY:  "GBPJPY=X",
  XAUUSD:  "GC=F",
  XAGUSD:  "SI=F",
  WTICOUSD: "CL=F",
  BCOUSD: "BZ=F",
  NATGASUSD: "NG=F",
  SPX: "^GSPC",
  NDX: "^NDX",
  DJI: "^DJI",
  UKX: "^FTSE",
  DAX: "^GDAXI",
  NKY: "^N225",
  BTCUSD: "BTC-USD",
  ETHUSD: "ETH-USD",
};

function normalizeYahooApexSymbol(apexSymbol: string): string {
  return canonicalizeMarketSymbol(apexSymbol) ?? apexSymbol.toUpperCase();
}

interface YahooChartResult {
  timestamp?: (number | null)[];
  meta?: {
    regularMarketPrice?: number;
    chartPreviousClose?: number;
  };
  indicators?: {
    quote?: Array<{
      open?:   (number | null)[];
      high?:   (number | null)[];
      low?:    (number | null)[];
      close?:  (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

interface YahooResponse {
  chart?: { result?: YahooChartResult[] | null; error?: unknown };
}

// Timeframe → Yahoo interval + range
const TIMEFRAME_PARAMS: Record<string, { interval: string; range: string }> = {
  "1m":  { interval: "1m",  range: "1d"  },
  "5m":  { interval: "5m",  range: "2d"  },
  "15m": { interval: "15m", range: "5d"  },
  "1h":  { interval: "1h",  range: "5d"  },
  "4h":  { interval: "60m", range: "30d" }, // Yahoo has no 4h; use 1h
  "1D":  { interval: "1d",  range: "60d" },
};

export type YahooCandle = {
  timestamp: number; // milliseconds
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number | null;
};

export type YahooCandleResult = {
  candles:          YahooCandle[];
  selectedProvider: string;
  provider:         string;
  fallbackUsed:     boolean;
  freshnessMs:      number | null;
  freshnessClass:   "fresh" | "stale" | "expired";
  marketStatus:     "LIVE" | "DEGRADED" | "UNAVAILABLE";
  degraded:         boolean;
  stale:            boolean;
  reason:           string | null;
  circuitState:     null;
  providerHealthScore: number | null;
  sourceType:       "fresh";
  fromCache:        boolean;
  priority:         string;
};

function candleIntervalMs(timeframe: string) {
  switch (timeframe) {
    case "1m": return 60_000;
    case "5m": return 5 * 60_000;
    case "15m": return 15 * 60_000;
    case "1h": return 60 * 60_000;
    case "4h": return 4 * 60 * 60_000;
    case "1D": return 24 * 60 * 60_000;
    default: return 60 * 60_000;
  }
}

export function aggregateYahooCandles(candles: YahooCandle[], timeframe: string) {
  if (timeframe !== "4h") {
    return candles;
  }

  const bucketMs = candleIntervalMs("4h");
  const buckets = new Map<number, YahooCandle[]>();

  for (const candle of candles) {
    const bucket = Math.floor(candle.timestamp / bucketMs) * bucketMs;
    if (!buckets.has(bucket)) {
      buckets.set(bucket, []);
    }
    buckets.get(bucket)!.push(candle);
  }

  return Array.from(buckets.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([timestamp, group]) => ({
      timestamp,
      open: group[0]?.open ?? group[0]?.close ?? 0,
      high: Math.max(...group.map(item => item.high)),
      low: Math.min(...group.map(item => item.low)),
      close: group.at(-1)?.close ?? group[0]?.close ?? 0,
      volume: group.reduce<number | null>((sum, item) => sum == null || item.volume == null ? sum ?? item.volume : sum + item.volume, null),
    }))
    .filter(candle => candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0);
}

/** Fetch from the first host that succeeds (query1 → query2 fallback). */
async function fetchYahooJson(path: string): Promise<{ res: Response; data: YahooResponse } | null> {
  for (const host of YAHOO_HOSTS) {
    try {
      const res = await fetch(`${host}/v8/finance/chart${path}`, {
        signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
        cache:   "no-store",
      });
      if (!res.ok) continue;
      const data = await res.json() as YahooResponse;
      return { res, data };
    } catch {
      // try next host
    }
  }
  return null;
}

export async function fetchYahooCandles(
  apexSymbol: string,
  timeframe: string,
): Promise<YahooCandleResult> {
  const unavailable: YahooCandleResult = {
    candles: [],
    selectedProvider: "Yahoo Finance",
    provider: "Yahoo Finance",
    fallbackUsed: false,
    freshnessMs: null,
    freshnessClass: "expired",
    marketStatus: "UNAVAILABLE",
    degraded: true,
    stale: true,
    reason: "unavailable",
    circuitState: null,
    providerHealthScore: null,
    sourceType: "fresh",
    fromCache: false,
    priority: "hot",
  };

  const normalizedApexSymbol = normalizeYahooApexSymbol(apexSymbol);
  const yahooSymbol = YAHOO_SYMBOL_MAP[normalizedApexSymbol];
  if (!yahooSymbol) return unavailable;

  const params = TIMEFRAME_PARAMS[timeframe] ?? TIMEFRAME_PARAMS["1D"];
  const path = `/${encodeURIComponent(yahooSymbol)}?interval=${params.interval}&range=${params.range}&includePrePost=false`;

  const startedAt = Date.now();

  try {
    const fetched = await fetchYahooJson(path);
    if (!fetched) {
      await recordProviderHealth({
        provider: "Yahoo Finance", requestSymbol: normalizedApexSymbol,
        latencyMs: Date.now() - startedAt, status: "ERROR", errorRate: 1,
        detail: "all_hosts_failed",
      });
      return { ...unavailable, reason: "all_hosts_failed" };
    }

    const result = fetched.data?.chart?.result?.[0];

    if (!result) {
      await recordProviderHealth({
        provider: "Yahoo Finance", requestSymbol: normalizedApexSymbol,
        latencyMs: Date.now() - startedAt, status: "DEGRADED", errorRate: 1,
        detail: "empty_result",
      });
      return { ...unavailable, reason: "empty_result" };
    }

    const timestamps = result.timestamp ?? [];
    const quote      = result.indicators?.quote?.[0] ?? {};
    const opens      = quote.open   ?? [];
    const highs      = quote.high   ?? [];
    const lows       = quote.low    ?? [];
    const closeArr   = quote.close  ?? [];
    const volumes    = quote.volume ?? [];

    const candles: YahooCandle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const ts    = timestamps[i];
      const open  = opens[i];
      const high  = highs[i];
      const low   = lows[i];
      const close = closeArr[i];

      if (
        ts == null || !Number.isFinite(ts) ||
        open  == null || !Number.isFinite(open)  || open  <= 0 ||
        high  == null || !Number.isFinite(high)  || high  <= 0 ||
        low   == null || !Number.isFinite(low)   || low   <= 0 ||
        close == null || !Number.isFinite(close) || close <= 0
      ) {
        continue;
      }

      const vol = volumes[i];
      candles.push({
        timestamp: ts * 1000, // seconds → milliseconds
        open,
        high,
        low,
        close,
        volume: typeof vol === "number" && Number.isFinite(vol) ? vol : null,
      });
    }

    const normalizedCandles = aggregateYahooCandles(candles, timeframe);
    const latencyMs = Date.now() - startedAt;
    await recordProviderHealth({
      provider: "Yahoo Finance", requestSymbol: normalizedApexSymbol,
      latencyMs, status: normalizedCandles.length > 0 ? "OK" : "DEGRADED",
      errorRate: normalizedCandles.length > 0 ? 0 : 1,
      detail: normalizedCandles.length > 0 ? undefined : "no_candles",
    });

    return {
      candles: normalizedCandles,
      selectedProvider:    "Yahoo Finance",
      provider:            "Yahoo Finance",
      fallbackUsed:        false,
      freshnessMs:         latencyMs,
      freshnessClass:      "fresh",
      marketStatus:        normalizedCandles.length > 0 ? "LIVE" : "DEGRADED",
      degraded:            normalizedCandles.length === 0,
      stale:               false,
      reason:              normalizedCandles.length > 0 ? null : "no_candles",
      circuitState:        null,
      providerHealthScore: null,
      sourceType:          "fresh",
      fromCache:           false,
      priority:            "hot",
    };
  } catch (err) {
    await recordProviderHealth({
      provider: "Yahoo Finance", requestSymbol: normalizedApexSymbol,
      latencyMs: Date.now() - startedAt, status: "ERROR", errorRate: 1,
      detail: `exception:${String(err).slice(0, 120)}`,
    });
    return { ...unavailable, reason: `exception:${String(err).slice(0, 80)}` };
  }
}

export async function fetchYahooHistoricalCandles(
  apexSymbol: string,
  timeframe: string,
  input: {
    start: Date;
    end: Date;
  }
): Promise<YahooCandleResult> {
  const unavailable: YahooCandleResult = {
    candles: [],
    selectedProvider: "Yahoo Finance",
    provider: "Yahoo Finance",
    fallbackUsed: false,
    freshnessMs: null,
    freshnessClass: "expired",
    marketStatus: "UNAVAILABLE",
    degraded: true,
    stale: true,
    reason: "unavailable",
    circuitState: null,
    providerHealthScore: null,
    sourceType: "fresh",
    fromCache: false,
    priority: "warm",
  };

  const normalizedApexSymbol = normalizeYahooApexSymbol(apexSymbol);
  const yahooSymbol = YAHOO_SYMBOL_MAP[normalizedApexSymbol];
  if (!yahooSymbol) return unavailable;

  const params = TIMEFRAME_PARAMS[timeframe] ?? TIMEFRAME_PARAMS["1D"];
  const period1 = Math.floor(input.start.getTime() / 1000);
  const period2 = Math.floor(input.end.getTime() / 1000);
  const path = `/${encodeURIComponent(yahooSymbol)}?interval=${params.interval}&period1=${period1}&period2=${period2}&includePrePost=false`;

  const startedAt = Date.now();
  try {
    const fetched = await fetchYahooJson(path);
    if (!fetched) {
      await recordProviderHealth({
        provider: "Yahoo Finance",
        requestSymbol: normalizedApexSymbol,
        latencyMs: Date.now() - startedAt,
        status: "ERROR",
        errorRate: 1,
        detail: "all_hosts_failed",
      });
      return { ...unavailable, reason: "all_hosts_failed" };
    }

    const result = fetched.data?.chart?.result?.[0];
    if (!result) {
      await recordProviderHealth({
        provider: "Yahoo Finance",
        requestSymbol: normalizedApexSymbol,
        latencyMs: Date.now() - startedAt,
        status: "DEGRADED",
        errorRate: 1,
        detail: "empty_result",
      });
      return { ...unavailable, reason: "empty_result" };
    }

    const timestamps = result.timestamp ?? [];
    const quote = result.indicators?.quote?.[0] ?? {};
    const candles = timestamps
      .map((timestamp, index) => {
        const open = quote.open?.[index];
        const high = quote.high?.[index];
        const low = quote.low?.[index];
        const close = quote.close?.[index];
        const volume = quote.volume?.[index] ?? null;
        if (
          timestamp == null ||
          open == null || !Number.isFinite(open) || open <= 0 ||
          high == null || !Number.isFinite(high) || high <= 0 ||
          low == null || !Number.isFinite(low) || low <= 0 ||
          close == null || !Number.isFinite(close) || close <= 0
        ) {
          return null;
        }

        return {
          timestamp: timestamp * 1000,
          open,
          high,
          low,
          close,
          volume: typeof volume === "number" && Number.isFinite(volume) ? volume : null,
        } satisfies YahooCandle;
      })
      .filter((candle): candle is YahooCandle => candle != null);

    const normalizedCandles = aggregateYahooCandles(candles, timeframe);
    return {
      candles: normalizedCandles,
      selectedProvider: "Yahoo Finance",
      provider: "Yahoo Finance",
      fallbackUsed: false,
      freshnessMs: Date.now() - startedAt,
      freshnessClass: "fresh",
      marketStatus: normalizedCandles.length > 0 ? "LIVE" : "DEGRADED",
      degraded: normalizedCandles.length === 0,
      stale: false,
      reason: normalizedCandles.length > 0 ? null : "no_candles",
      circuitState: null,
      providerHealthScore: null,
      sourceType: "fresh",
      fromCache: false,
      priority: "warm",
    };
  } catch (error) {
    await recordProviderHealth({
      provider: "Yahoo Finance",
      requestSymbol: normalizedApexSymbol,
      latencyMs: Date.now() - startedAt,
      status: "ERROR",
      errorRate: 1,
      detail: `exception:${String(error).slice(0, 160)}`,
    });
    return { ...unavailable, reason: `exception:${String(error).slice(0, 80)}` };
  }
}

export async function fetchYahooPrice(apexSymbol: string): Promise<{
  price:     number | null;
  closes:    number[];
  high14d:   number | null;
  low14d:    number | null;
  change24h: number | null;
}> {
  const empty = { price: null, closes: [], high14d: null, low14d: null, change24h: null };

  const normalizedApexSymbol = normalizeYahooApexSymbol(apexSymbol);
  const yahooSymbol = YAHOO_SYMBOL_MAP[normalizedApexSymbol];
  if (!yahooSymbol) return empty;

  const startedAt = Date.now();

  try {
    const path = `/${encodeURIComponent(yahooSymbol)}?interval=1d&range=60d&includePrePost=false`;
    const fetched = await fetchYahooJson(path);

    if (!fetched) {
      console.error(`[APEX:yahoo] All hosts failed for ${normalizedApexSymbol} (${yahooSymbol})`);
      await recordProviderHealth({
        provider:      "Yahoo Finance",
        requestSymbol: normalizedApexSymbol,
        latencyMs:     Date.now() - startedAt,
        status:        "ERROR",
        errorRate:     1,
        detail:        "all_hosts_failed",
      });
      return empty;
    }

    const result = fetched.data?.chart?.result?.[0];

    if (!result) {
      console.error(`[APEX:yahoo] No chart result for ${normalizedApexSymbol}`);
      await recordProviderHealth({
        provider:      "Yahoo Finance",
        requestSymbol: normalizedApexSymbol,
        latencyMs:     Date.now() - startedAt,
        status:        "DEGRADED",
        errorRate:     1,
        detail:        "empty_result",
      });
      return empty;
    }

    const price = typeof result.meta?.regularMarketPrice === "number" && result.meta.regularMarketPrice > 0
      ? result.meta.regularMarketPrice
      : null;

    const previousClose = typeof result.meta?.chartPreviousClose === "number" && result.meta.chartPreviousClose > 0
      ? result.meta.chartPreviousClose
      : null;

    const change24h = price != null && previousClose != null
      ? ((price - previousClose) / previousClose) * 100
      : null;

    const quoteBar = result.indicators?.quote?.[0];

    const closes = (quoteBar?.close ?? [])
      .filter((c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0);

    const highs = (quoteBar?.high ?? [])
      .filter((h): h is number => typeof h === "number" && Number.isFinite(h) && h > 0);

    const lows = (quoteBar?.low ?? [])
      .filter((l): l is number => typeof l === "number" && Number.isFinite(l) && l > 0);

    const high14d = highs.length ? Math.max(...highs.slice(-14)) : null;
    const low14d  = lows.length  ? Math.min(...lows.slice(-14))  : null;

    console.log(`[APEX:yahoo] ${normalizedApexSymbol} → price=${price}, closes=${closes.length}, change24h=${change24h?.toFixed(3)}`);

    await recordProviderHealth({
      provider:      "Yahoo Finance",
      requestSymbol: normalizedApexSymbol,
      latencyMs:     Date.now() - startedAt,
      status:        price != null ? "OK" : "DEGRADED",
      errorRate:     price != null ? 0 : 1,
      detail:        price != null ? undefined : "null_price",
    });

    return { price, closes, high14d, low14d, change24h };
  } catch (err) {
    console.error(`[APEX:yahoo] Request failed for ${normalizedApexSymbol}:`, err);
    await recordProviderHealth({
      provider:      "Yahoo Finance",
      requestSymbol: normalizedApexSymbol,
      latencyMs:     Date.now() - startedAt,
      status:        "ERROR",
      errorRate:     1,
      detail:        `exception:${String(err).slice(0, 160)}`,
    });
    return empty;
  }
}
