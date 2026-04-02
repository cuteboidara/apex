import type { Candle } from "@/src/smc/types";
import { recordProviderHealth } from "@/lib/providerHealth";

const POLYGON_BASE = "https://api.polygon.io";

export type PolygonSymbolType = "stock" | "commodity" | "index" | "forex";
export type PolygonCandle = Candle;
export type PolygonFeedStatus = "unknown" | "ready" | "not_configured" | "not_authorized" | "no_data" | "error";

export type PolygonFeedSnapshot = {
  status: PolygonFeedStatus;
  message: string | null;
  checkedAt: number | null;
  ticker: string | null;
};

type PolygonRuntimeState = {
  candleCache: Map<string, { candles: PolygonCandle[]; fetchedAt: number }>;
  priceCache: Map<string, { price: number; fetchedAt: number }>;
  feedSnapshots: Map<PolygonSymbolType, PolygonFeedSnapshot>;
};

const globalForPolygonDataPlant = globalThis as typeof globalThis & {
  __apexPolygonDataPlant?: PolygonRuntimeState;
};

const polygonRuntimeState = globalForPolygonDataPlant.__apexPolygonDataPlant ??= {
  candleCache: new Map<string, { candles: PolygonCandle[]; fetchedAt: number }>(),
  priceCache: new Map<string, { price: number; fetchedAt: number }>(),
  feedSnapshots: new Map<PolygonSymbolType, PolygonFeedSnapshot>(),
};

const CANDLE_CACHE_TTL_MS = 60_000;
const PRICE_CACHE_TTL_MS = 15_000;
const FEED_FAILURE_TTL_MS = 15 * 60_000;

export interface EarningsEvent {
  symbol: string;
  reportDate: string;
  fiscalQuarter: string;
  estimatedEPS: number | null;
  reportedEPS: number | null;
  daysUntil: number;
}

export function isPolygonConfigured(): boolean {
  return Boolean(process.env.POLYGON_API_KEY);
}

function getDefaultFeedSnapshot(): PolygonFeedSnapshot {
  return {
    status: "unknown",
    message: null,
    checkedAt: null,
    ticker: null,
  };
}

function updateFeedSnapshot(
  type: PolygonSymbolType,
  status: PolygonFeedStatus,
  message: string | null,
  ticker: string | null,
): void {
  polygonRuntimeState.feedSnapshots.set(type, {
    status,
    message,
    checkedAt: Date.now(),
    ticker,
  });
}

function shouldShortCircuit(type: PolygonSymbolType): boolean {
  const snapshot = polygonRuntimeState.feedSnapshots.get(type);
  if (!snapshot?.checkedAt) {
    return false;
  }

  if (Date.now() - snapshot.checkedAt > FEED_FAILURE_TTL_MS) {
    return false;
  }

  return snapshot.status === "not_authorized";
}

async function readPolygonErrorMessage(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { message?: string; status?: string };
    return payload.message ?? payload.status ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function getPolygonFeedSnapshot(type: PolygonSymbolType): PolygonFeedSnapshot {
  return polygonRuntimeState.feedSnapshots.get(type) ?? getDefaultFeedSnapshot();
}

function buildPolygonTicker(symbol: string, type: PolygonSymbolType): string {
  switch (type) {
    case "index":
      return symbol.startsWith("I:") ? symbol : `I:${symbol}`;
    case "commodity":
    case "forex":
      return symbol.startsWith("C:") ? symbol : `C:${symbol}`;
    case "stock":
    default:
      return symbol;
  }
}

function resolveTimespanWindowMs(timespan: "minute" | "hour" | "day"): number {
  if (timespan === "hour") {
    return 60 * 60 * 1000;
  }
  if (timespan === "day") {
    return 24 * 60 * 60 * 1000;
  }
  return 60 * 1000;
}

export async function fetchPolygonCandles(
  symbol: string,
  type: PolygonSymbolType = "stock",
  timespan: "minute" | "hour" | "day" = "minute",
  multiplier = 15,
  limit = 100,
): Promise<PolygonCandle[]> {
  const cacheKey = `${symbol}:${type}:${timespan}:${multiplier}:${limit}`;
  const cached = polygonRuntimeState.candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL_MS) {
    return cached.candles;
  }

  if (!isPolygonConfigured()) {
    updateFeedSnapshot(type, "not_configured", "POLYGON_API_KEY not set.", null);
    console.warn("[polygon] POLYGON_API_KEY not set");
    return [];
  }

  if (shouldShortCircuit(type)) {
    return [];
  }

  try {
    const startedAt = Date.now();
    const to = new Date();
    const timespanWindowMs = resolveTimespanWindowMs(timespan);
    const from = new Date(to.getTime() - (limit * multiplier * timespanWindowMs * 2));
    const ticker = buildPolygonTicker(symbol, type);
    const url = `${POLYGON_BASE}/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${from.toISOString().split("T")[0]}/${to.toISOString().split("T")[0]}?adjusted=true&sort=asc&limit=${limit}&apiKey=${process.env.POLYGON_API_KEY}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url, { signal: controller.signal }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      const message = await readPolygonErrorMessage(response);
      await recordProviderHealth({
        provider: "Polygon",
        requestSymbol: symbol,
        status: response.status === 403 ? "not_authorized" : "error",
        latencyMs: Date.now() - startedAt,
        detail: `asset=${type} ticker=${ticker} timespan=${timespan} multiplier=${multiplier} message=${message}`,
      });
      updateFeedSnapshot(
        type,
        response.status === 403 ? "not_authorized" : "error",
        message,
        ticker,
      );
      throw new Error(`Polygon fetch failed: ${response.status} for ${ticker} (${message})`);
    }

    const data = await response.json() as {
      results?: Array<{ t: number; o: number; h: number; l: number; c: number; v?: number }>;
    };

    if (!data.results?.length) {
      await recordProviderHealth({
        provider: "Polygon",
        requestSymbol: symbol,
        status: "no_data",
        latencyMs: Date.now() - startedAt,
        detail: `asset=${type} ticker=${ticker} timespan=${timespan} multiplier=${multiplier} results=0`,
      });
      updateFeedSnapshot(type, "no_data", `Polygon returned no candle data for ${ticker}.`, ticker);
      console.warn(`[polygon] No results for ${ticker}`);
      return [];
    }

    const candles: PolygonCandle[] = data.results.map(result => ({
      time: Math.floor(result.t / 1000),
      open: result.o,
      high: result.h,
      low: result.l,
      close: result.c,
      volume: result.v ?? 0,
    }));

    polygonRuntimeState.candleCache.set(cacheKey, {
      candles,
      fetchedAt: Date.now(),
    });
    await recordProviderHealth({
      provider: "Polygon",
      requestSymbol: symbol,
      status: "healthy",
      latencyMs: Date.now() - startedAt,
      detail: `asset=${type} ticker=${ticker} timespan=${timespan} multiplier=${multiplier} bars=${candles.length}`,
    });
    updateFeedSnapshot(type, "ready", null, ticker);
    return candles;
  } catch (error) {
    console.error(`[polygon] Candle fetch failed for ${symbol}:`, error);
    return polygonRuntimeState.candleCache.get(cacheKey)?.candles ?? [];
  }
}

export async function fetchPolygonLivePrice(
  symbol: string,
  type: PolygonSymbolType = "stock",
): Promise<number | null> {
  const cacheKey = `${symbol}:${type}`;
  const cached = polygonRuntimeState.priceCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cached.price;
  }

  if (!isPolygonConfigured()) {
    updateFeedSnapshot(type, "not_configured", "POLYGON_API_KEY not set.", null);
    return null;
  }

  if (shouldShortCircuit(type)) {
    return null;
  }

  try {
    const startedAt = Date.now();
    const ticker = buildPolygonTicker(symbol, type);
    const url = `${POLYGON_BASE}/v2/last/trade/${ticker}?apiKey=${process.env.POLYGON_API_KEY}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout ? AbortSignal.timeout(5_000) : undefined,
    });

    if (!response.ok) {
      const message = await readPolygonErrorMessage(response);
      await recordProviderHealth({
        provider: "Polygon",
        requestSymbol: symbol,
        status: response.status === 403 ? "not_authorized" : "error",
        latencyMs: Date.now() - startedAt,
        detail: `asset=${type} ticker=${ticker} live_price=true message=${message}`,
      });
      updateFeedSnapshot(
        type,
        response.status === 403 ? "not_authorized" : "error",
        message,
        ticker,
      );
      const candles = polygonRuntimeState.candleCache.get(`${symbol}:${type}:minute:15:100`)?.candles;
      return candles?.[candles.length - 1]?.close ?? null;
    }

    const data = await response.json() as { results?: { p?: number } };
    const price = data.results?.p ?? null;
    if (price != null) {
      polygonRuntimeState.priceCache.set(cacheKey, {
        price,
        fetchedAt: Date.now(),
      });
      await recordProviderHealth({
        provider: "Polygon",
        requestSymbol: symbol,
        status: "healthy",
        latencyMs: Date.now() - startedAt,
        detail: `asset=${type} ticker=${ticker} live_price=true`,
      });
      updateFeedSnapshot(type, "ready", null, ticker);
    } else {
      await recordProviderHealth({
        provider: "Polygon",
        requestSymbol: symbol,
        status: "no_data",
        latencyMs: Date.now() - startedAt,
        detail: `asset=${type} ticker=${ticker} live_price=true results=0`,
      });
      updateFeedSnapshot(type, "no_data", `Polygon returned no live price for ${ticker}.`, ticker);
    }
    return price;
  } catch (error) {
    console.error(`[polygon] Price fetch failed for ${symbol}:`, error);
    return polygonRuntimeState.priceCache.get(cacheKey)?.price ?? null;
  }
}

export async function fetchPolygonPrices(
  symbols: readonly string[],
  type: PolygonSymbolType,
): Promise<Record<string, number | null>> {
  const results = await Promise.allSettled(
    symbols.map(async symbol => ({
      symbol,
      price: await fetchPolygonLivePrice(symbol, type),
    })),
  );

  const prices: Record<string, number | null> = {};
  for (const result of results) {
    if (result.status === "fulfilled") {
      prices[result.value.symbol] = result.value.price;
    }
  }
  return prices;
}

export async function fetchUpcomingEarnings(symbols: readonly string[]): Promise<EarningsEvent[]> {
  if (!isPolygonConfigured()) {
    return [];
  }

  const results: EarningsEvent[] = [];
  const today = new Date();

  for (const symbol of symbols.slice(0, 20)) {
    try {
      const url = `${POLYGON_BASE}/vX/reference/financials?ticker=${symbol}&limit=4&apiKey=${process.env.POLYGON_API_KEY}`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(5_000) : undefined,
      });
      if (!response.ok) {
        continue;
      }

      const data = await response.json() as {
        results?: Array<{
          filing_date: string;
          fiscal_period: string;
        }>;
      };

      if (!data.results?.[0]) {
        continue;
      }

      const latest = data.results[0];
      const reportDate = new Date(latest.filing_date);
      const daysUntil = Math.round((reportDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      results.push({
        symbol,
        reportDate: latest.filing_date,
        fiscalQuarter: latest.fiscal_period,
        estimatedEPS: null,
        reportedEPS: null,
        daysUntil,
      });
    } catch {
      continue;
    }
  }

  return results;
}
