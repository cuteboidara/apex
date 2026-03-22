import { recordProviderHealth } from "@/lib/providerHealth";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const REQUEST_TIMEOUT_MS = 8000;

export const YAHOO_SYMBOL_MAP: Record<string, string> = {
  EURUSD:  "EURUSD=X",
  GBPUSD:  "GBPUSD=X",
  USDJPY:  "USDJPY=X",
  XAUUSD:  "GC=F",
  XAGUSD:  "SI=F",
  USDCAD:  "CAD=X",
  AUDUSD:  "AUDUSD=X",
  NZDUSD:  "NZDUSD=X",
  USDCHF:  "CHF=X",
  EURJPY:  "EURJPY=X",
  GBPJPY:  "GBPJPY=X",
};

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

  const yahooSymbol = YAHOO_SYMBOL_MAP[apexSymbol];
  if (!yahooSymbol) return unavailable;

  const params = TIMEFRAME_PARAMS[timeframe] ?? TIMEFRAME_PARAMS["1D"];
  const url = `${YAHOO_BASE}/${encodeURIComponent(yahooSymbol)}?interval=${params.interval}&range=${params.range}&includePrePost=false`;

  const startedAt = Date.now();

  try {
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      cache:   "no-store",
    });

    if (!res.ok) {
      await recordProviderHealth({
        provider: "Yahoo Finance", requestSymbol: apexSymbol,
        latencyMs: Date.now() - startedAt, status: "ERROR", errorRate: 1,
        detail: `http_${res.status}`,
      });
      return { ...unavailable, reason: `http_${res.status}` };
    }

    const data   = await res.json() as YahooResponse;
    const result = data?.chart?.result?.[0];

    if (!result) {
      await recordProviderHealth({
        provider: "Yahoo Finance", requestSymbol: apexSymbol,
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

    const latencyMs = Date.now() - startedAt;
    await recordProviderHealth({
      provider: "Yahoo Finance", requestSymbol: apexSymbol,
      latencyMs, status: candles.length > 0 ? "OK" : "DEGRADED",
      errorRate: candles.length > 0 ? 0 : 1,
      detail: candles.length > 0 ? undefined : "no_candles",
    });

    return {
      candles,
      selectedProvider:    "Yahoo Finance",
      provider:            "Yahoo Finance",
      fallbackUsed:        false,
      freshnessMs:         latencyMs,
      freshnessClass:      "fresh",
      marketStatus:        candles.length > 0 ? "LIVE" : "DEGRADED",
      degraded:            candles.length === 0,
      stale:               false,
      reason:              candles.length > 0 ? null : "no_candles",
      circuitState:        null,
      providerHealthScore: null,
      sourceType:          "fresh",
      fromCache:           false,
      priority:            "hot",
    };
  } catch (err) {
    await recordProviderHealth({
      provider: "Yahoo Finance", requestSymbol: apexSymbol,
      latencyMs: Date.now() - startedAt, status: "ERROR", errorRate: 1,
      detail: `exception:${String(err).slice(0, 120)}`,
    });
    return { ...unavailable, reason: `exception:${String(err).slice(0, 80)}` };
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

  const yahooSymbol = YAHOO_SYMBOL_MAP[apexSymbol];
  if (!yahooSymbol) return empty;

  const startedAt = Date.now();

  try {
    const url = `${YAHOO_BASE}/${encodeURIComponent(yahooSymbol)}?interval=1d&range=60d&includePrePost=false`;
    const res = await fetch(url, {
      signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      cache:   "no-store",
    });

    if (!res.ok) {
      console.error(`[APEX:yahoo] HTTP ${res.status} for ${apexSymbol} (${yahooSymbol})`);
      await recordProviderHealth({
        provider:      "Yahoo Finance",
        requestSymbol: apexSymbol,
        latencyMs:     Date.now() - startedAt,
        status:        "ERROR",
        errorRate:     1,
        detail:        `http_${res.status}`,
      });
      return empty;
    }

    const data   = await res.json() as YahooResponse;
    const result = data?.chart?.result?.[0];

    if (!result) {
      console.error(`[APEX:yahoo] No chart result for ${apexSymbol}`);
      await recordProviderHealth({
        provider:      "Yahoo Finance",
        requestSymbol: apexSymbol,
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

    console.log(`[APEX:yahoo] ${apexSymbol} → price=${price}, closes=${closes.length}, change24h=${change24h?.toFixed(3)}`);

    await recordProviderHealth({
      provider:      "Yahoo Finance",
      requestSymbol: apexSymbol,
      latencyMs:     Date.now() - startedAt,
      status:        price != null ? "OK" : "DEGRADED",
      errorRate:     price != null ? 0 : 1,
      detail:        price != null ? undefined : "null_price",
    });

    return { price, closes, high14d, low14d, change24h };
  } catch (err) {
    console.error(`[APEX:yahoo] Request failed for ${apexSymbol}:`, err);
    await recordProviderHealth({
      provider:      "Yahoo Finance",
      requestSymbol: apexSymbol,
      latencyMs:     Date.now() - startedAt,
      status:        "ERROR",
      errorRate:     1,
      detail:        `exception:${String(err).slice(0, 160)}`,
    });
    return empty;
  }
}
