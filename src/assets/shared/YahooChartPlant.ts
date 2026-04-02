import { fetchYahooBars } from "@/src/lib/yahooFinance";
import type { PolygonCandle } from "@/src/assets/shared/PolygonDataPlant";

type CachedCandles = {
  candles: PolygonCandle[];
  sourceSymbol: string;
  fetchedAt: number;
};

const CANDLE_CACHE_TTL_MS = 60_000;

const globalForYahooChartPlant = globalThis as typeof globalThis & {
  __apexYahooChartCandles?: Map<string, CachedCandles>;
};

const candleCache = globalForYahooChartPlant.__apexYahooChartCandles ??= new Map<string, CachedCandles>();

export async function fetchYahooChartCandles(
  symbol: string,
  interval = "1D",
  bars = 100,
): Promise<{ candles: PolygonCandle[]; sourceSymbol: string | null }> {
  const cacheKey = `${symbol}:${interval}:${bars}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL_MS) {
    return {
      candles: cached.candles,
      sourceSymbol: cached.sourceSymbol,
    };
  }

  const result = await fetchYahooBars(symbol, interval);
  if (!result) {
    return {
      candles: [],
      sourceSymbol: null,
    };
  }

  const candles = result.values.slice(-bars).map(value => ({
    time: Math.floor(Date.parse(value.datetime) / 1000),
    open: value.open,
    high: value.high,
    low: value.low,
    close: value.close,
    volume: value.volume,
  }));

  candleCache.set(cacheKey, {
    candles,
    sourceSymbol: result.sourceSymbol,
    fetchedAt: Date.now(),
  });

  return {
    candles,
    sourceSymbol: result.sourceSymbol,
  };
}
