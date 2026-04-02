import type { PolygonCandle } from "@/src/assets/shared/PolygonDataPlant";
import { recordProviderHealth } from "@/lib/providerHealth";

const STOOQ_BASE = "https://stooq.com/q/d/l/";
const CANDLE_CACHE_TTL_MS = 60_000;

const STOOQ_SYMBOL_MAP = {
  XAUUSD: "xauusd",
  XAGUSD: "xagusd",
  WTICOUSD: "cl.f",
  BCOUSD: "co.f",
  NATGASUSD: "ng.f",
} as const;

type StooqCommoditySymbol = keyof typeof STOOQ_SYMBOL_MAP;
type CachedCandles = {
  candles: PolygonCandle[];
  fetchedAt: number;
};

const globalForStooqCommodityPlant = globalThis as typeof globalThis & {
  __apexStooqCommodityCandles?: Map<StooqCommoditySymbol, CachedCandles>;
};

const candleCache = globalForStooqCommodityPlant.__apexStooqCommodityCandles ??= new Map<
  StooqCommoditySymbol,
  CachedCandles
>();

function buildDateRange() {
  const end = new Date();
  const start = new Date(end.getTime() - (400 * 24 * 60 * 60 * 1000));
  return {
    start: start.toISOString().slice(0, 10).replaceAll("-", ""),
    end: end.toISOString().slice(0, 10).replaceAll("-", ""),
  };
}

function parseCsv(text: string, bars: number): PolygonCandle[] {
  const lines = text.trim().split(/\r?\n/u);
  if (lines.length < 2) {
    return [];
  }

  const candles: PolygonCandle[] = [];
  for (const line of lines.slice(1).slice(-bars)) {
    const [dateStr, open, high, low, close, volume] = line.split(",");
    const time = Date.parse(dateStr);
    const parsed = {
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume ?? 0),
    };

    if (
      !Number.isFinite(time)
      || !Number.isFinite(parsed.open)
      || !Number.isFinite(parsed.high)
      || !Number.isFinite(parsed.low)
      || !Number.isFinite(parsed.close)
      || parsed.close <= 0
    ) {
      continue;
    }

    candles.push({
      time: Math.floor(time / 1000),
      open: parsed.open,
      high: parsed.high,
      low: parsed.low,
      close: parsed.close,
      volume: Number.isFinite(parsed.volume) ? parsed.volume : 0,
    });
  }

  return candles;
}

export async function fetchStooqCommodityCandles(
  internalSymbol: StooqCommoditySymbol,
  bars = 100,
): Promise<PolygonCandle[]> {
  const cached = candleCache.get(internalSymbol);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL_MS) {
    return cached.candles;
  }

  const stooqSymbol = STOOQ_SYMBOL_MAP[internalSymbol];
  if (!stooqSymbol) {
    console.warn(`[stooq] No commodity mapping for ${internalSymbol}`);
    return [];
  }

  try {
    const startedAt = Date.now();
    const url = new URL(STOOQ_BASE);
    url.searchParams.set("s", stooqSymbol);
    url.searchParams.set("i", "d");
    const range = buildDateRange();
    url.searchParams.set("d1", range.start);
    url.searchParams.set("d2", range.end);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
    }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      await recordProviderHealth({
        provider: "Stooq",
        requestSymbol: internalSymbol,
        status: "error",
        latencyMs: Date.now() - startedAt,
        detail: `asset=commodity status=${response.status}`,
      });
      throw new Error(`Stooq fetch failed: ${response.status}`);
    }

    const body = await response.text();
    const candles = parseCsv(body, bars);
    if (body.length === 0) {
      await recordProviderHealth({
        provider: "Stooq",
        requestSymbol: internalSymbol,
        status: "empty_body",
        latencyMs: Date.now() - startedAt,
        detail: "asset=commodity empty_body=true",
      });
      console.warn(`[stooq] Empty response body for ${internalSymbol}`);
    }
    if (candles.length > 0) {
      candleCache.set(internalSymbol, {
        candles,
        fetchedAt: Date.now(),
      });
      await recordProviderHealth({
        provider: "Stooq",
        requestSymbol: internalSymbol,
        status: "healthy",
        latencyMs: Date.now() - startedAt,
        detail: `asset=commodity bars=${candles.length}`,
      });
    } else {
      await recordProviderHealth({
        provider: "Stooq",
        requestSymbol: internalSymbol,
        status: "no_data",
        latencyMs: Date.now() - startedAt,
        detail: "asset=commodity bars=0",
      });
    }
    return candles;
  } catch (error) {
    console.error(`[stooq] Failed for ${internalSymbol}:`, error);
    return candleCache.get(internalSymbol)?.candles ?? [];
  }
}

export async function fetchStooqCurrentPrice(internalSymbol: StooqCommoditySymbol): Promise<number | null> {
  const candles = await fetchStooqCommodityCandles(internalSymbol, 2);
  return candles[candles.length - 1]?.close ?? null;
}
