import { recordProviderHealth } from "@/lib/providerHealth";
import type { Timeframe } from "@/lib/marketData/types";

const FINNHUB_KEY = process.env.FINNHUB_API_KEY ?? "";
const BASE = "https://finnhub.io/api/v1";
const FX_METAL_SYMBOLS = new Set(["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "XAGUSD"]);
const MAX_RAW_LOG_LENGTH = 320;

interface FinnhubQuote {
  c?: number;
  d?: number;
  dp?: number;
  h?: number;
  l?: number;
  o?: number;
  pc?: number;
  t?: number;
}

interface FinnhubCandle {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  t: number[];
  v: number[];
  s: string;
}

const FINNHUB_RESOLUTION: Record<Timeframe, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1h": "60",
  "4h": "240",
  "1D": "D",
};

const FINNHUB_LOOKBACK_SECONDS: Record<Timeframe, number> = {
  "1m": 12 * 60 * 60,
  "5m": 3 * 24 * 60 * 60,
  "15m": 7 * 24 * 60 * 60,
  "1h": 21 * 24 * 60 * 60,
  "4h": 60 * 24 * 60 * 60,
  "1D": 365 * 24 * 60 * 60,
};

type LiveQuoteResult = {
  price: number | null;
  change24h: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  updatedAt: string | null;
  provider: "Finnhub";
  status: "LIVE" | "DEGRADED" | "UNAVAILABLE";
  reason: string | null;
};

function truncateRaw(payload: unknown): string {
  const json = JSON.stringify(payload);
  if (json.length <= MAX_RAW_LOG_LENGTH) return json;
  return `${json.slice(0, MAX_RAW_LOG_LENGTH)}...`;
}

function logRawResponse(symbol: string, endpoint: string, payload: unknown) {
  if (!FX_METAL_SYMBOLS.has(symbol)) return;
  console.log(`[APEX:finnhub] ${symbol} ${endpoint} raw=${truncateRaw(payload)}`);
}

async function get<T>(path: string, requestSymbol?: string): Promise<{ ok: boolean; status: number | null; data: T | null }> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}token=${FINNHUB_KEY}`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  const rawText = await res.text();
  let data: T | null = null;

  try {
    data = rawText ? JSON.parse(rawText) as T : null;
  } catch {
    if (requestSymbol) {
      const endpoint = path.split("?")[0];
      logRawResponse(requestSymbol, `${endpoint}:non_json`, rawText);
    }
    return { ok: false, status: res.status, data: null };
  }

  if (requestSymbol) {
    const endpoint = path.split("?")[0];
    logRawResponse(requestSymbol, endpoint, data);
  }

  if (!res.ok) {
    return { ok: false, status: res.status, data };
  }

  return { ok: true, status: res.status, data };
}

function toPositiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function toNullableNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toIsoFromUnix(value: unknown): string | null {
  const unix = Number(value);
  if (!Number.isFinite(unix) || unix <= 0) return null;
  return new Date(unix * 1000).toISOString();
}

function isFreshTimestamp(iso: string | null, maxAgeMs: number): boolean {
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return false;
  return (Date.now() - ts) <= maxAgeMs;
}

async function recordHealth(params: {
  requestSymbol: string;
  status: "OK" | "DEGRADED" | "ERROR";
  latencyMs: number;
  detail: string;
  errorRate: number;
}) {
  await recordProviderHealth({
    provider: "Finnhub",
    requestSymbol: params.requestSymbol,
    status: params.status,
    latencyMs: params.latencyMs,
    detail: params.detail,
    errorRate: params.errorRate,
  });
}

export async function fetchLiveFxMetalQuote(requestSymbol: string, providerSymbol: string): Promise<LiveQuoteResult> {
  const startedAt = Date.now();

  try {
    const quoteResponse = await get<FinnhubQuote>(`/quote?symbol=${encodeURIComponent(providerSymbol)}`, requestSymbol);

    if (!quoteResponse.ok || !quoteResponse.data) {
      await recordHealth({
        requestSymbol,
        status: "ERROR",
        latencyMs: Date.now() - startedAt,
        detail: `quote_request_failed:${quoteResponse.status ?? "network"}`,
        errorRate: 1,
      });
      return {
        price: null,
        change24h: null,
        changePct: null,
        high: null,
        low: null,
        volume: null,
        updatedAt: null,
        provider: "Finnhub",
        status: "UNAVAILABLE",
        reason: "Quote request failed.",
      };
    }

    const quote = quoteResponse.data;
    const price = toPositiveNumber(quote.c);
    const updatedAt = toIsoFromUnix(quote.t);

    if (price == null) {
      await recordHealth({
        requestSymbol,
        status: "DEGRADED",
        latencyMs: Date.now() - startedAt,
        detail: "parse_failure:missing_or_zero_price",
        errorRate: 1,
      });
      return {
        price: null,
        change24h: null,
        changePct: null,
        high: null,
        low: null,
        volume: null,
        updatedAt,
        provider: "Finnhub",
        status: "UNAVAILABLE",
        reason: "Provider returned no valid live price.",
      };
    }

    if (!isFreshTimestamp(updatedAt, 15 * 60 * 1000)) {
      await recordHealth({
        requestSymbol,
        status: "DEGRADED",
        latencyMs: Date.now() - startedAt,
        detail: `stale_timestamp:${updatedAt ?? "missing"}`,
        errorRate: 1,
      });
      return {
        price: null,
        change24h: null,
        changePct: null,
        high: null,
        low: null,
        volume: null,
        updatedAt,
        provider: "Finnhub",
        status: "DEGRADED",
        reason: "Provider quote is stale.",
      };
    }

    await recordHealth({
      requestSymbol,
      status: "OK",
      latencyMs: Date.now() - startedAt,
      detail: "quote_ok",
      errorRate: 0,
    });

    return {
      price,
      change24h: toNullableNumber(quote.d),
      changePct: toNullableNumber(quote.dp),
      high: toPositiveNumber(quote.h),
      low: toPositiveNumber(quote.l),
      volume: null,
      updatedAt,
      provider: "Finnhub",
      status: "LIVE",
      reason: null,
    };
  } catch (error) {
    await recordHealth({
      requestSymbol,
      status: "ERROR",
      latencyMs: Date.now() - startedAt,
      detail: `exception:${String(error).slice(0, 160)}`,
      errorRate: 1,
    });
    return {
      price: null,
      change24h: null,
      changePct: null,
      high: null,
      low: null,
      volume: null,
      updatedAt: null,
      provider: "Finnhub",
      status: "UNAVAILABLE",
      reason: "Provider request failed.",
    };
  }
}

export async function fetchRecentForexCandles(providerSymbol: string, requestSymbol?: string): Promise<FinnhubCandle | null> {
  const now = Math.floor(Date.now() / 1000);
  const from = now - FINNHUB_LOOKBACK_SECONDS["1h"];
  const response = await get<FinnhubCandle>(
    `/forex/candle?symbol=${encodeURIComponent(providerSymbol)}&resolution=60&from=${from}&to=${now}`,
    requestSymbol,
  );

  if (!response.ok || !response.data || response.data.s !== "ok") {
    return null;
  }

  return response.data;
}

export type FinnhubCandleResult = {
  candles: Array<{
    timestamp: number;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    volume: number | null;
  }>;
  timestamp: number | null;
  provider: "Finnhub";
  status: "LIVE" | "DEGRADED" | "UNAVAILABLE";
  reason: string | null;
};

export async function fetchFxMetalCandles(
  requestSymbol: string,
  providerSymbol: string,
  timeframe: Timeframe
): Promise<FinnhubCandleResult> {
  const startedAt = Date.now();
  const now = Math.floor(Date.now() / 1000);
  const from = now - FINNHUB_LOOKBACK_SECONDS[timeframe];
  const resolution = FINNHUB_RESOLUTION[timeframe];

  try {
    const response = await get<FinnhubCandle>(
      `/forex/candle?symbol=${encodeURIComponent(providerSymbol)}&resolution=${resolution}&from=${from}&to=${now}`,
      requestSymbol,
    );

    if (!response.ok || !response.data || response.data.s !== "ok") {
      await recordHealth({
        requestSymbol,
        status: "DEGRADED",
        latencyMs: Date.now() - startedAt,
        detail: `candle_request_failed:${timeframe}:${response.status ?? "network"}`,
        errorRate: 1,
      });
      return {
        candles: [],
        timestamp: null,
        provider: "Finnhub",
        status: "UNAVAILABLE",
        reason: "Candle request failed.",
      };
    }

    const candleData = response.data;
    const candles = candleData.t.map((ts, index) => ({
      timestamp: ts * 1000,
      open: toNullableNumber(candleData.o[index]),
      high: toNullableNumber(candleData.h[index]),
      low: toNullableNumber(candleData.l[index]),
      close: toNullableNumber(candleData.c[index]),
      volume: toNullableNumber(candleData.v[index]),
    })).filter(candle => candle.timestamp > 0);

    if (candles.length === 0) {
      await recordHealth({
        requestSymbol,
        status: "DEGRADED",
        latencyMs: Date.now() - startedAt,
        detail: `empty_candles:${timeframe}`,
        errorRate: 1,
      });
      return {
        candles: [],
        timestamp: null,
        provider: "Finnhub",
        status: "DEGRADED",
        reason: "Provider returned no candle data.",
      };
    }

    await recordHealth({
      requestSymbol,
      status: "OK",
      latencyMs: Date.now() - startedAt,
      detail: `candles_ok:${timeframe}`,
      errorRate: 0,
    });

    return {
      candles,
      timestamp: candles.at(-1)?.timestamp ?? null,
      provider: "Finnhub",
      status: "LIVE",
      reason: null,
    };
  } catch (error) {
    await recordHealth({
      requestSymbol,
      status: "ERROR",
      latencyMs: Date.now() - startedAt,
      detail: `candle_exception:${timeframe}:${String(error).slice(0, 120)}`,
      errorRate: 1,
    });
    return {
      candles: [],
      timestamp: null,
      provider: "Finnhub",
      status: "UNAVAILABLE",
      reason: "Provider candle request failed.",
    };
  }
}

export interface FinnhubNewsItem {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export async function fetchMarketNews(category: "forex" | "crypto" | "general"): Promise<FinnhubNewsItem[]> {
  try {
    const response = await get<FinnhubNewsItem[]>(`/news?category=${category}`);
    return Array.isArray(response.data) ? response.data : [];
  } catch {
    return [];
  }
}

export interface EconomicEvent {
  actual: number | null;
  country: string;
  estimate: number | null;
  event: string;
  impact: string;
  prev: number | null;
  time: string;
  unit: string;
}

interface CalendarResponse {
  economicCalendar: EconomicEvent[];
}

export async function fetchEconomicCalendar(): Promise<EconomicEvent[]> {
  try {
    const response = await get<CalendarResponse>("/calendar/economic");
    return Array.isArray(response.data?.economicCalendar) ? response.data.economicCalendar : [];
  } catch {
    return [];
  }
}
