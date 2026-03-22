import { recordProviderHealth } from "@/lib/providerHealth";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const REQUEST_TIMEOUT_MS = 8000;

const SYMBOL_MAP: Record<string, string> = {
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
  meta?: {
    regularMarketPrice?: number;
    chartPreviousClose?: number;
  };
  indicators?: {
    quote?: Array<{
      close?: (number | null)[];
      high?:  (number | null)[];
      low?:   (number | null)[];
    }>;
  };
}

interface YahooResponse {
  chart?: { result?: YahooChartResult[] | null; error?: unknown };
}

export async function fetchYahooPrice(apexSymbol: string): Promise<{
  price:     number | null;
  closes:    number[];
  high14d:   number | null;
  low14d:    number | null;
  change24h: number | null;
}> {
  const empty = { price: null, closes: [], high14d: null, low14d: null, change24h: null };

  const yahooSymbol = SYMBOL_MAP[apexSymbol];
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
