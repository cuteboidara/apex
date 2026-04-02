import type { PolygonCandle } from "@/src/assets/shared/PolygonDataPlant";
import type { IndexSymbol } from "@/src/assets/indices/config/indicesScope";
import { recordProviderHealth } from "@/lib/providerHealth";

const STOOQ_BASE = "https://stooq.com/q/d/l/";
const CANDLE_CACHE_TTL_MS = 60_000;
const MAX_CONCURRENCY = 3;

const STOOQ_INDEX_MAP: Record<IndexSymbol, string> = {
  SPX: "^spx",
  NDX: "^ndx",
  DJI: "^dji",
  UKX: "^ukx",
  DAX: "^dax",
  NKY: "^nky",
};

type CachedCandles = {
  candles: PolygonCandle[];
  fetchedAt: number;
};

const globalForStooqIndices = globalThis as typeof globalThis & {
  __apexStooqIndexCandles?: Map<IndexSymbol, CachedCandles>;
};

const candleCache = globalForStooqIndices.__apexStooqIndexCandles ??= new Map<IndexSymbol, CachedCandles>();

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

async function mapWithConcurrency<TInput, TOutput>(
  items: readonly TInput[],
  limit: number,
  worker: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]!);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function buildDateRange() {
  const end = new Date();
  const start = new Date(end.getTime() - (400 * 24 * 60 * 60 * 1000));
  return {
    start: start.toISOString().slice(0, 10).replaceAll("-", ""),
    end: end.toISOString().slice(0, 10).replaceAll("-", ""),
  };
}

export async function fetchStooqIndexCandles(indexSymbol: IndexSymbol, bars = 100): Promise<PolygonCandle[]> {
  const cached = candleCache.get(indexSymbol);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL_MS) {
    return cached.candles;
  }

  const stooqSymbol = STOOQ_INDEX_MAP[indexSymbol];
  if (!stooqSymbol) {
    console.warn(`[stooq-indices] No mapping for ${indexSymbol}`);
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
        requestSymbol: indexSymbol,
        status: "error",
        latencyMs: Date.now() - startedAt,
        detail: `asset=index status=${response.status}`,
      });
      throw new Error(`Stooq index fetch failed: ${response.status}`);
    }

    const body = await response.text();
    const candles = parseCsv(body, bars);
    if (body.length === 0) {
      await recordProviderHealth({
        provider: "Stooq",
        requestSymbol: indexSymbol,
        status: "empty_body",
        latencyMs: Date.now() - startedAt,
        detail: "asset=index empty_body=true",
      });
      console.warn(`[stooq-indices] Empty response body for ${indexSymbol}`);
    }
    if (candles.length > 0) {
      candleCache.set(indexSymbol, {
        candles,
        fetchedAt: Date.now(),
      });
      await recordProviderHealth({
        provider: "Stooq",
        requestSymbol: indexSymbol,
        status: "healthy",
        latencyMs: Date.now() - startedAt,
        detail: `asset=index bars=${candles.length}`,
      });
    } else {
      await recordProviderHealth({
        provider: "Stooq",
        requestSymbol: indexSymbol,
        status: "no_data",
        latencyMs: Date.now() - startedAt,
        detail: "asset=index bars=0",
      });
    }
    return candles;
  } catch (error) {
    console.error(`[stooq-indices] Failed for ${indexSymbol}:`, error);
    return candleCache.get(indexSymbol)?.candles ?? [];
  }
}

export async function fetchStooqIndexPrice(indexSymbol: IndexSymbol): Promise<number | null> {
  const candles = await fetchStooqIndexCandles(indexSymbol, 2);
  return candles[candles.length - 1]?.close ?? null;
}

export async function fetchAllIndexCandles(): Promise<Record<IndexSymbol, PolygonCandle[]>> {
  const symbols = Object.keys(STOOQ_INDEX_MAP) as IndexSymbol[];
  const results = await mapWithConcurrency(symbols, MAX_CONCURRENCY, async symbol => ({
    symbol,
    candles: await fetchStooqIndexCandles(symbol, 100),
  }));

  return Object.fromEntries(results.map(result => [result.symbol, result.candles])) as Record<IndexSymbol, PolygonCandle[]>;
}

export async function fetchAllIndexPrices(): Promise<Record<IndexSymbol, number | null>> {
  const symbols = Object.keys(STOOQ_INDEX_MAP) as IndexSymbol[];
  const results = await mapWithConcurrency(symbols, MAX_CONCURRENCY, async symbol => ({
    symbol,
    price: await fetchStooqIndexPrice(symbol),
  }));

  return Object.fromEntries(results.map(result => [result.symbol, result.price])) as Record<IndexSymbol, number | null>;
}
