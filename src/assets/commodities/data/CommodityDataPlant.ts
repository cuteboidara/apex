import type { CommoditySymbol } from "@/src/assets/commodities/config/commoditiesScope";
import { fetchPolygonCandles, getPolygonFeedSnapshot, isPolygonConfigured } from "@/src/assets/shared/PolygonDataPlant";
import type { Candle } from "@/src/smc/types";

export type CommodityProviderName = "polygon" | "twelve_data" | null;
export type CommodityProviderStatus =
  | "unknown"
  | "ready"
  | "fallback"
  | "not_configured"
  | "not_authorized"
  | "rate_limited"
  | "unsupported"
  | "no_data"
  | "error";

export type CommodityFeedSnapshot = {
  provider: CommodityProviderName;
  status: CommodityProviderStatus;
  message: string | null;
  checkedAt: number | null;
};

const TWELVE_DATA_BASE = "https://api.twelvedata.com";
const CANDLE_CACHE_TTL_MS = 60_000;
const PRICE_CACHE_TTL_MS = 15_000;
const FAILURE_TTL_MS = 15 * 60_000;
const POLYGON_METALS = new Set<CommoditySymbol>(["XAUUSD", "XAGUSD"]);

const TWELVE_DATA_SYMBOLS: Record<CommoditySymbol, string> = {
  XAUUSD: "XAU/USD",
  XAGUSD: "XAG/USD",
  WTICOUSD: "WTI/USD",
  BCOUSD: "BRENT/USD",
  NATGASUSD: "NATGAS/USD",
};

type CommodityDataPlantState = {
  candleCache: Map<CommoditySymbol, { candles: Candle[]; fetchedAt: number }>;
  priceCache: Map<CommoditySymbol, { price: number; fetchedAt: number }>;
  feedSnapshots: Map<CommoditySymbol, CommodityFeedSnapshot>;
  twelveDataRateLimit:
    | {
      message: string;
      checkedAt: number;
    }
    | null;
};

const globalForCommodityDataPlant = globalThis as typeof globalThis & {
  __apexCommodityDataPlant?: CommodityDataPlantState;
};

const commodityDataPlantState = globalForCommodityDataPlant.__apexCommodityDataPlant ??= {
  candleCache: new Map<CommoditySymbol, { candles: Candle[]; fetchedAt: number }>(),
  priceCache: new Map<CommoditySymbol, { price: number; fetchedAt: number }>(),
  feedSnapshots: new Map<CommoditySymbol, CommodityFeedSnapshot>(),
  twelveDataRateLimit: null,
};

function getDefaultSnapshot(): CommodityFeedSnapshot {
  return {
    provider: null,
    status: "unknown",
    message: null,
    checkedAt: null,
  };
}

function updateSnapshot(
  symbol: CommoditySymbol,
  provider: CommodityProviderName,
  status: CommodityProviderStatus,
  message: string | null,
): void {
  commodityDataPlantState.feedSnapshots.set(symbol, {
    provider,
    status,
    message,
    checkedAt: Date.now(),
  });
}

function normalizeTwelveDataKey(): string | null {
  const raw = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!raw) {
    return null;
  }
  return raw.replace(/^"/, "").replace(/"$/, "");
}

function isTwelveDataRateLimited(): boolean {
  return Boolean(
    commodityDataPlantState.twelveDataRateLimit
    && Date.now() - commodityDataPlantState.twelveDataRateLimit.checkedAt < FAILURE_TTL_MS,
  );
}

function setTwelveDataRateLimited(message: string): void {
  commodityDataPlantState.twelveDataRateLimit = {
    message,
    checkedAt: Date.now(),
  };
}

function splitCommodityPair(symbol: CommoditySymbol): { base: string; quote: string } {
  return {
    base: symbol.slice(0, 3),
    quote: symbol.slice(3),
  };
}

async function fetchPolygonMetalPrice(symbol: CommoditySymbol): Promise<number | null> {
  const cacheEntry = commodityDataPlantState.priceCache.get(symbol);
  if (cacheEntry && Date.now() - cacheEntry.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cacheEntry.price;
  }

  if (!isPolygonConfigured()) {
    updateSnapshot(symbol, "polygon", "not_configured", "POLYGON_API_KEY not set.");
    return null;
  }

  const polygonFeed = getPolygonFeedSnapshot("forex");
  if (polygonFeed.status === "not_authorized" && polygonFeed.checkedAt && Date.now() - polygonFeed.checkedAt < FAILURE_TTL_MS) {
    updateSnapshot(symbol, "polygon", "not_authorized", polygonFeed.message);
    return null;
  }

  const { base, quote } = splitCommodityPair(symbol);
  const url = `https://api.polygon.io/v1/last_quote/currencies/${base}/${quote}?apiKey=${process.env.POLYGON_API_KEY}`;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: string } | null;
      const message = payload?.message ?? `Polygon HTTP ${response.status}`;
      updateSnapshot(
        symbol,
        "polygon",
        response.status === 403 ? "not_authorized" : "error",
        message,
      );
      return null;
    }

    const payload = await response.json() as {
      last?: {
        ask?: number;
        bid?: number;
      };
    };

    const ask = payload.last?.ask;
    const bid = payload.last?.bid;
    const price = [ask, bid].filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .reduce((sum, value, _, values) => sum + value / values.length, 0);

    if (!price || !Number.isFinite(price)) {
      updateSnapshot(symbol, "polygon", "no_data", `Polygon returned no live quote for ${symbol}.`);
      return null;
    }

    commodityDataPlantState.priceCache.set(symbol, {
      price,
      fetchedAt: Date.now(),
    });
    updateSnapshot(symbol, "polygon", "ready", null);
    return price;
  } catch (error) {
    updateSnapshot(symbol, "polygon", "error", error instanceof Error ? error.message : String(error));
    return null;
  }
}

type TwelveDataTimeSeriesResponse = {
  status?: string;
  message?: string;
  values?: Array<{
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: string;
  }>;
};

function buildTwelveDataSymbol(symbol: CommoditySymbol): string {
  return TWELVE_DATA_SYMBOLS[symbol];
}

function buildTwelveDataMessage(payload: { message?: string; status?: string } | null, fallback: string): string {
  return payload?.message ?? payload?.status ?? fallback;
}

async function fetchTwelveDataCandles(symbol: CommoditySymbol): Promise<Candle[]> {
  const cacheEntry = commodityDataPlantState.candleCache.get(symbol);
  if (cacheEntry && Date.now() - cacheEntry.fetchedAt < CANDLE_CACHE_TTL_MS) {
    return cacheEntry.candles;
  }

  const apiKey = normalizeTwelveDataKey();
  if (!apiKey) {
    updateSnapshot(symbol, "twelve_data", "not_configured", "TWELVE_DATA_API_KEY not set.");
    return [];
  }

  if (isTwelveDataRateLimited()) {
    updateSnapshot(
      symbol,
      "twelve_data",
      "rate_limited",
      commodityDataPlantState.twelveDataRateLimit?.message ?? "Twelve Data daily credits exhausted.",
    );
    return [];
  }

  const url = new URL(`${TWELVE_DATA_BASE}/time_series`);
  url.searchParams.set("symbol", buildTwelveDataSymbol(symbol));
  url.searchParams.set("interval", "15min");
  url.searchParams.set("outputsize", "100");
  url.searchParams.set("format", "JSON");
  url.searchParams.set("apikey", apiKey);

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json().catch(() => null) as TwelveDataTimeSeriesResponse | null;

    if (!response.ok || payload?.status === "error") {
      const message = buildTwelveDataMessage(payload, `Twelve Data HTTP ${response.status}`);
      if (/run out of api credits|daily limit/i.test(message)) {
        setTwelveDataRateLimited(message);
        updateSnapshot(symbol, "twelve_data", "rate_limited", message);
      } else {
        updateSnapshot(symbol, "twelve_data", "error", message);
      }
      return [];
    }

    const candles = [...(payload?.values ?? [])]
      .reverse()
      .flatMap(value => {
        const time = Date.parse(value.datetime);
        const open = Number(value.open);
        const high = Number(value.high);
        const low = Number(value.low);
        const close = Number(value.close);
        const volume = value.volume != null ? Number(value.volume) : 0;
        if (
          !Number.isFinite(time)
          || !Number.isFinite(open)
          || !Number.isFinite(high)
          || !Number.isFinite(low)
          || !Number.isFinite(close)
        ) {
          return [];
        }
        return [{
          time: Math.floor(time / 1000),
          open,
          high,
          low,
          close,
          volume: Number.isFinite(volume) ? volume : 0,
        } satisfies Candle];
      });

    if (candles.length === 0) {
      updateSnapshot(symbol, "twelve_data", "no_data", `Twelve Data returned no candles for ${symbol}.`);
      return [];
    }

    commodityDataPlantState.candleCache.set(symbol, {
      candles,
      fetchedAt: Date.now(),
    });
    updateSnapshot(symbol, "twelve_data", "fallback", "Using Twelve Data fallback.");
    return candles;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateSnapshot(symbol, "twelve_data", "error", message);
    return commodityDataPlantState.candleCache.get(symbol)?.candles ?? [];
  }
}

async function fetchTwelveDataPrice(symbol: CommoditySymbol): Promise<number | null> {
  const cacheEntry = commodityDataPlantState.priceCache.get(symbol);
  if (cacheEntry && Date.now() - cacheEntry.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cacheEntry.price;
  }

  const apiKey = normalizeTwelveDataKey();
  if (!apiKey) {
    updateSnapshot(symbol, "twelve_data", "not_configured", "TWELVE_DATA_API_KEY not set.");
    return null;
  }

  if (isTwelveDataRateLimited()) {
    updateSnapshot(
      symbol,
      "twelve_data",
      "rate_limited",
      commodityDataPlantState.twelveDataRateLimit?.message ?? "Twelve Data daily credits exhausted.",
    );
    return null;
  }

  const url = new URL(`${TWELVE_DATA_BASE}/price`);
  url.searchParams.set("symbol", buildTwelveDataSymbol(symbol));
  url.searchParams.set("apikey", apiKey);

  try {
    const response = await fetch(url.toString(), {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json().catch(() => null) as { status?: string; message?: string; price?: string } | null;

    if (!response.ok || payload?.status === "error") {
      const message = buildTwelveDataMessage(payload, `Twelve Data HTTP ${response.status}`);
      if (/run out of api credits|daily limit/i.test(message)) {
        setTwelveDataRateLimited(message);
        updateSnapshot(symbol, "twelve_data", "rate_limited", message);
      } else {
        updateSnapshot(symbol, "twelve_data", "error", message);
      }
      return null;
    }

    const price = Number(payload?.price);
    if (!Number.isFinite(price) || price <= 0) {
      updateSnapshot(symbol, "twelve_data", "no_data", `Twelve Data returned no live price for ${symbol}.`);
      return null;
    }

    commodityDataPlantState.priceCache.set(symbol, {
      price,
      fetchedAt: Date.now(),
    });
    updateSnapshot(symbol, "twelve_data", "fallback", "Using Twelve Data fallback.");
    return price;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateSnapshot(symbol, "twelve_data", "error", message);
    return commodityDataPlantState.priceCache.get(symbol)?.price ?? null;
  }
}

export async function fetchCommodityCandles(symbol: CommoditySymbol): Promise<Candle[]> {
  if (POLYGON_METALS.has(symbol)) {
    const candles = await fetchPolygonCandles(symbol, "forex", "minute", 15, 100);
    if (candles.length > 0) {
      updateSnapshot(symbol, "polygon", "ready", null);
      return candles;
    }

    const polygonSnapshot = getPolygonFeedSnapshot("forex");
    if (polygonSnapshot.status === "not_authorized") {
      updateSnapshot(symbol, "polygon", "not_authorized", polygonSnapshot.message);
    }
  } else {
    updateSnapshot(symbol, "polygon", "unsupported", "Polygon does not provide this commodity feed on the current route.");
  }

  return fetchTwelveDataCandles(symbol);
}

export async function fetchCommodityLivePrice(symbol: CommoditySymbol): Promise<number | null> {
  if (POLYGON_METALS.has(symbol)) {
    const price = await fetchPolygonMetalPrice(symbol);
    if (price != null) {
      return price;
    }
  } else {
    updateSnapshot(symbol, "polygon", "unsupported", "Polygon does not provide this commodity feed on the current route.");
  }

  return fetchTwelveDataPrice(symbol);
}

export function getCommodityFeedSnapshot(symbol: CommoditySymbol): CommodityFeedSnapshot {
  return commodityDataPlantState.feedSnapshots.get(symbol) ?? getDefaultSnapshot();
}

export function getCommodityProviderBanner(): {
  status: "ready" | "degraded" | "not_configured";
  notice: string | null;
} {
  const snapshots = [...commodityDataPlantState.feedSnapshots.values()];

  if (!isPolygonConfigured() && !normalizeTwelveDataKey()) {
    return {
      status: "not_configured",
      notice: "No commodity data provider is configured.",
    };
  }

  if (snapshots.some(snapshot => snapshot.status === "fallback" || snapshot.status === "ready")) {
    const usingFallback = snapshots.some(snapshot => snapshot.provider === "twelve_data" && snapshot.status === "fallback");
    return {
      status: "ready",
      notice: usingFallback
        ? "Using Twelve Data fallback because the current Polygon plan does not include currencies."
        : null,
    };
  }

  if (snapshots.some(snapshot => snapshot.status === "rate_limited")) {
    const polygonLimited = snapshots.some(snapshot => snapshot.status === "not_authorized");
    return {
      status: "degraded",
      notice: polygonLimited
        ? `Polygon does not include commodity currencies on the current plan, and ${commodityDataPlantState.twelveDataRateLimit?.message ?? "Twelve Data fallback is temporarily unavailable."}`
        : commodityDataPlantState.twelveDataRateLimit?.message ?? "Twelve Data daily credits are exhausted, so commodity fallback is temporarily unavailable.",
    };
  }

  if (snapshots.some(snapshot => snapshot.status === "not_authorized")) {
    return {
      status: "degraded",
      notice: "Polygon does not include commodity currencies on the current plan. Twelve Data fallback will be used when available.",
    };
  }

  return {
    status: "ready",
    notice: null,
  };
}
