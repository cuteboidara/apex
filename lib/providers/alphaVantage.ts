import { readFileSync } from "node:fs";
import path from "node:path";

import { recordProviderHealth } from "@/lib/providerHealth";

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";
const REQUEST_TIMEOUT_MS = 8000;
const FX_CACHE_TTL_MS = 60 * 1000;
const METALS_CACHE_TTL_MS = 5 * 60 * 1000;
const FX_FRESHNESS_MS = 20 * 60 * 1000;
const METALS_FRESHNESS_MS = 36 * 60 * 60 * 1000;

type ProviderStatus = "LIVE" | "DEGRADED" | "UNAVAILABLE";

export type AlphaVantageNormalizedQuote = {
  symbol: string;
  provider: "Alpha Vantage";
  price: number | null;
  timestamp: number | null;
  change24h: number | null;
  high14d: number | null;
  low14d: number | null;
  closes: number[];
  stale: boolean;
  marketStatus: ProviderStatus;
  reason: string | null;
};

type CacheEntry = {
  expiresAt: number;
  value: AlphaVantageNormalizedQuote;
};

const cache = new Map<string, CacheEntry>();

function readEnvFileValue(filename: string, key: string): string | null {
  try {
    const file = readFileSync(path.join(process.cwd(), filename), "utf8");
    for (const line of file.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (!trimmed.startsWith(`${key}=`)) continue;
      return trimmed.split("=", 2)[1]?.trim().replace(/^"(.*)"$/, "$1") ?? null;
    }
  } catch {
    return null;
  }

  return null;
}

function getAlphaVantageApiKey(): string | null {
  const envValue = process.env.ALPHA_VANTAGE_API_KEY;
  if (envValue && envValue !== "PASTE_YOUR_KEY_HERE") {
    return envValue;
  }

  return (
    readEnvFileValue(".env.local", "ALPHA_VANTAGE_API_KEY") ??
    readEnvFileValue(".env", "ALPHA_VANTAGE_API_KEY")
  );
}

function toPositiveNumber(value: unknown): number | null {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function toTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  const asString = typeof value === "string" ? value : null;
  if (!asString) return null;
  const parsed = Date.parse(asString.includes("T") ? asString : `${asString} UTC`);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchAlphaVantageJson(params: Record<string, string>, requestSymbol: string) {
  const apiKey = getAlphaVantageApiKey();
  if (!apiKey) {
    console.error(`[AlphaVantage] Missing ALPHA_VANTAGE_API_KEY for ${requestSymbol}`);
    return null;
  }

  const url = new URL(ALPHA_VANTAGE_BASE);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("apikey", apiKey);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) {
      console.error(`[AlphaVantage] HTTP ${res.status} ${res.statusText} for ${requestSymbol}`);
      return null;
    }

    return await res.json() as Record<string, unknown>;
  } catch (error) {
    console.error(`[AlphaVantage] Request failed for ${requestSymbol}: ${String(error)}`);
    return null;
  }
}

async function recordHealth(
  requestSymbol: string,
  status: "OK" | "DEGRADED" | "ERROR",
  startedAt: number,
  detail: string
) {
  await recordProviderHealth({
    provider: "Alpha Vantage",
    requestSymbol,
    latencyMs: Date.now() - startedAt,
    status,
    errorRate: status === "OK" ? 0 : 1,
    detail,
  });
}

function getCached(key: string): AlphaVantageNormalizedQuote | null {
  const entry = cache.get(key);
  if (!entry || entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.value;
}

function setCached(key: string, ttlMs: number, value: AlphaVantageNormalizedQuote) {
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

function unavailableQuote(symbol: string, reason: string): AlphaVantageNormalizedQuote {
  return {
    symbol,
    provider: "Alpha Vantage",
    price: null,
    timestamp: null,
    change24h: null,
    high14d: null,
    low14d: null,
    closes: [],
    stale: true,
    marketStatus: "UNAVAILABLE",
    reason,
  };
}

function degradedQuote(symbol: string, reason: string, partial?: Partial<AlphaVantageNormalizedQuote>): AlphaVantageNormalizedQuote {
  return {
    symbol,
    provider: "Alpha Vantage",
    price: partial?.price ?? null,
    timestamp: partial?.timestamp ?? null,
    change24h: partial?.change24h ?? null,
    high14d: partial?.high14d ?? null,
    low14d: partial?.low14d ?? null,
    closes: partial?.closes ?? [],
    stale: true,
    marketStatus: "DEGRADED",
    reason,
  };
}

function normalizeSeriesValues(payload: Record<string, unknown>, key: string) {
  const series = payload[key] as Record<string, Record<string, string>> | undefined;
  if (!series) return [];

  return Object.entries(series)
    .map(([date, point]) => ({
      date,
      high: toPositiveNumber(point["2. high"] ?? point["2a. high (USD)"] ?? point["2. High"] ?? null),
      low: toPositiveNumber(point["3. low"] ?? point["3a. low (USD)"] ?? point["3. Low"] ?? null),
      close: toPositiveNumber(point["4. close"] ?? point["4a. close (USD)"] ?? point["4. Close"] ?? null),
    }))
    .filter(point => point.close != null)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

async function getForexHistory(fromSymbol: string, toSymbol: string, requestSymbol: string) {
  const payload = await fetchAlphaVantageJson(
    {
      function: "FX_DAILY",
      from_symbol: fromSymbol,
      to_symbol: toSymbol,
      outputsize: "compact",
    },
    requestSymbol,
  );

  if (!payload) return [];
  if (payload.Note || payload.Information || payload["Error Message"]) {
    return [];
  }

  return normalizeSeriesValues(payload, "Time Series FX (Daily)");
}

async function getMetalHistory(fromSymbol: "XAU" | "XAG", requestSymbol: string) {
  const payload = await fetchAlphaVantageJson(
    {
      function: "FX_DAILY",
      from_symbol: fromSymbol,
      to_symbol: "USD",
      outputsize: "compact",
    },
    requestSymbol,
  );

  if (!payload) return [];
  if (payload.Note || payload.Information || payload["Error Message"]) {
    return [];
  }

  return normalizeSeriesValues(payload, "Time Series FX (Daily)");
}

export async function getAlphaVantageForexQuote(symbol: "EURUSD" | "GBPUSD" | "USDJPY"): Promise<AlphaVantageNormalizedQuote> {
  const cached = getCached(symbol);
  if (cached) return cached;

  const startedAt = Date.now();
  const fromSymbol = symbol.slice(0, 3);
  const toSymbol = symbol.slice(3, 6);
  const quotePayload = await fetchAlphaVantageJson(
    {
      function: "FX_INTRADAY",
      from_symbol: fromSymbol,
      to_symbol: toSymbol,
      interval: "5min",
      outputsize: "compact",
    },
    symbol,
  );

  if (!quotePayload) {
    await recordHealth(symbol, "ERROR", startedAt, "empty_payload");
    return unavailableQuote(symbol, "Alpha Vantage FX_INTRADAY unavailable.");
  }

  const apiNote = quotePayload.Note ?? quotePayload.Information ?? quotePayload["Error Message"];
  if (apiNote) {
    await recordHealth(symbol, "DEGRADED", startedAt, String(apiNote).slice(0, 200));
    return degradedQuote(symbol, String(apiNote));
  }

  const meta = quotePayload["Meta Data"] as Record<string, string> | undefined;
  const series = normalizeSeriesValues(quotePayload, "Time Series FX (5min)");
  const latest = series[0];
  const previous = series[1];
  const timestamp = toTimestamp(meta?.["6. Last Refreshed"] ?? latest?.date ?? null);
  const price = latest?.close ?? null;

  if (price == null || price <= 0) {
    await recordHealth(symbol, "DEGRADED", startedAt, "parse_failure:price");
    return degradedQuote(symbol, "Alpha Vantage returned no valid FX price.");
  }

  if (timestamp == null || Date.now() - timestamp > FX_FRESHNESS_MS) {
    await recordHealth(symbol, "DEGRADED", startedAt, "stale_timestamp");
    return degradedQuote(symbol, "Alpha Vantage FX quote is stale.", {
      price,
      timestamp,
      closes: series.slice(0, 20).map(point => point.close!).filter((value): value is number => value != null),
      high14d: null,
      low14d: null,
    });
  }

  const history = await getForexHistory(fromSymbol, toSymbol, symbol);
  const closes = history.slice(0, 20).map(point => point.close!).filter((value): value is number => value != null);
  const highs = history.slice(0, 14).map(point => point.high).filter((value): value is number => value != null);
  const lows = history.slice(0, 14).map(point => point.low).filter((value): value is number => value != null);
  const change24h = previous?.close != null && previous.close > 0
    ? ((price - previous.close) / previous.close) * 100
    : null;

  const normalized: AlphaVantageNormalizedQuote = {
    symbol,
    provider: "Alpha Vantage",
    price,
    timestamp,
    change24h,
    high14d: highs.length > 0 ? Math.max(...highs) : null,
    low14d: lows.length > 0 ? Math.min(...lows) : null,
    closes,
    stale: false,
    marketStatus: "LIVE",
    reason: null,
  };

  await recordHealth(symbol, "OK", startedAt, "fx_intraday_ok");
  setCached(symbol, FX_CACHE_TTL_MS, normalized);
  return normalized;
}

export async function getAlphaVantageMetalQuote(symbol: "XAUUSD" | "XAGUSD"): Promise<AlphaVantageNormalizedQuote> {
  const cached = getCached(symbol);
  if (cached) return cached;

  const startedAt = Date.now();
  const metalType = symbol === "XAUUSD" ? "gold" : "silver";
  const spotPayload = await fetchAlphaVantageJson(
    {
      function: "CURRENCY_EXCHANGE_RATE",
      from_currency: symbol.slice(0, 3),
      to_currency: "USD",
    },
    symbol,
  );

  if (!spotPayload) {
    await recordHealth(symbol, "ERROR", startedAt, "empty_payload");
    return unavailableQuote(symbol, `Alpha Vantage ${metalType} quote unavailable.`);
  }

  const apiNote = spotPayload.Note ?? spotPayload.Information ?? spotPayload["Error Message"];
  if (apiNote) {
    await recordHealth(symbol, "DEGRADED", startedAt, String(apiNote).slice(0, 200));
    return degradedQuote(symbol, String(apiNote));
  }

  const exchangeRate =
    (spotPayload["Realtime Currency Exchange Rate"] as Record<string, string> | undefined)?.["5. Exchange Rate"];
  const refreshedAt =
    (spotPayload["Realtime Currency Exchange Rate"] as Record<string, string> | undefined)?.["6. Last Refreshed"];
  const price = toPositiveNumber(exchangeRate);
  const timestamp = toTimestamp(refreshedAt);

  if (price == null || price <= 0) {
    await recordHealth(symbol, "DEGRADED", startedAt, "parse_failure:price");
    return degradedQuote(symbol, `Alpha Vantage ${metalType} payload contained no valid price.`);
  }

  if (timestamp == null || Date.now() - timestamp > METALS_FRESHNESS_MS) {
    await recordHealth(symbol, "DEGRADED", startedAt, "stale_timestamp");
    return degradedQuote(symbol, `Alpha Vantage ${metalType} quote is stale.`, { price, timestamp });
  }

  const history = await getMetalHistory(symbol.slice(0, 3) as "XAU" | "XAG", symbol);
  const closes = history.slice(0, 20).map(point => point.close!).filter((value): value is number => value != null);
  const highs = history.slice(0, 14).map(point => point.high).filter((value): value is number => value != null);
  const lows = history.slice(0, 14).map(point => point.low).filter((value): value is number => value != null);
  const previousClose = history[1]?.close ?? null;
  const change24h = previousClose != null && previousClose > 0
    ? ((price - previousClose) / previousClose) * 100
    : null;

  const normalized: AlphaVantageNormalizedQuote = {
    symbol,
    provider: "Alpha Vantage",
    price,
    timestamp,
    change24h,
    high14d: highs.length > 0 ? Math.max(...highs) : null,
    low14d: lows.length > 0 ? Math.min(...lows) : null,
    closes,
    stale: false,
    marketStatus: "LIVE",
    reason: null,
  };

  await recordHealth(symbol, "OK", startedAt, "metal_quote_ok");
  setCached(symbol, METALS_CACHE_TTL_MS, normalized);
  return normalized;
}
