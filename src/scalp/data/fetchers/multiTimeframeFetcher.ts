import { getScalpCache, setScalpCache } from "@/src/scalp/data/cache/scalpCache";
import type { MultiTimeframeData, ScalpCandle, UpcomingNewsEvent } from "@/src/scalp/types/scalpTypes";

type YahooInterval = "15m" | "1h" | "1d";

type YahooQuote = {
  open?: Array<number | null>;
  high?: Array<number | null>;
  low?: Array<number | null>;
  close?: Array<number | null>;
  volume?: Array<number | null>;
};

type YahooResponse = {
  chart?: {
    result?: Array<{
      timestamp?: Array<number | null>;
      indicators?: { quote?: YahooQuote[] };
    }> | null;
  };
};

const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
] as const;

function intervalParam(interval: YahooInterval): string {
  if (interval === "15m") return "15m";
  if (interval === "1h") return "60m";
  return "1d";
}

function toNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function parseCandles(payload: YahooResponse): ScalpCandle[] {
  const row = payload.chart?.result?.[0];
  if (!row) return [];

  const timestamps = row.timestamp ?? [];
  const quote = row.indicators?.quote?.[0] ?? {};

  const candles: ScalpCandle[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const stamp = timestamps[i];
    if (typeof stamp !== "number" || !Number.isFinite(stamp)) continue;

    const open = toNumber(quote.open?.[i]);
    const high = toNumber(quote.high?.[i]);
    const low = toNumber(quote.low?.[i]);
    const close = toNumber(quote.close?.[i]);

    if (open == null || high == null || low == null || close == null) continue;
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;

    candles.push({
      timestamp: new Date(stamp * 1000),
      open,
      high,
      low,
      close,
      volume: toNumber(quote.volume?.[i]) ?? 0,
    });
  }

  candles.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return candles;
}

async function fetchYahooCandles(
  symbol: string,
  start: Date,
  end: Date,
  interval: YahooInterval,
): Promise<ScalpCandle[]> {
  const cacheKey = `scalp:${symbol}:${interval}:${Math.floor(start.getTime() / 60000)}:${Math.floor(end.getTime() / 60000)}`;
  const cached = getScalpCache<ScalpCandle[]>(cacheKey);
  if (cached) return cached;

  const period1 = Math.floor(start.getTime() / 1000);
  const period2 = Math.floor(end.getTime() / 1000);
  const intv = intervalParam(interval);

  for (const host of YAHOO_HOSTS) {
    try {
      const response = await fetch(
        `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${intv}&includePrePost=false`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(12_000),
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) continue;
      const payload = await response.json() as YahooResponse;
      const candles = parseCandles(payload);
      if (candles.length > 0) {
        setScalpCache(cacheKey, candles, 60_000);
      }
      return candles;
    } catch {
      continue;
    }
  }

  return [];
}

function aggregateTo4h(candles1h: ScalpCandle[]): ScalpCandle[] {
  if (candles1h.length < 4) return [];

  const buckets = new Map<number, ScalpCandle[]>();
  for (const candle of candles1h) {
    const bucketTime = Math.floor(candle.timestamp.getTime() / (4 * 60 * 60 * 1000)) * (4 * 60 * 60 * 1000);
    const bucket = buckets.get(bucketTime) ?? [];
    bucket.push(candle);
    buckets.set(bucketTime, bucket);
  }

  const result: ScalpCandle[] = [];
  const keys = [...buckets.keys()].sort((a, b) => a - b);

  for (const key of keys) {
    const bucket = buckets.get(key);
    if (!bucket || bucket.length < 4) continue;
    const sorted = [...bucket].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    result.push({
      timestamp: new Date(key),
      open: sorted[0].open,
      high: Math.max(...sorted.map(c => c.high)),
      low: Math.min(...sorted.map(c => c.low)),
      close: sorted[sorted.length - 1].close,
      volume: sorted.reduce((sum, c) => sum + c.volume, 0),
    });
  }

  return result;
}

async function fetchUpcomingNews(): Promise<UpcomingNewsEvent[]> {
  const baseUrl = process.env.NEXTAUTH_URL;
  if (!baseUrl) return [];

  try {
    const response = await fetch(`${baseUrl}/api/market/economic-calendar`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return [];

    const payload = await response.json() as { events?: UpcomingNewsEvent[] };
    return Array.isArray(payload.events) ? payload.events : [];
  } catch {
    return [];
  }
}

export async function fetchMultiTimeframe(symbol: string): Promise<MultiTimeframeData> {
  const end = new Date();
  // Use wider windows so weekends/market closures do not starve gate evaluation.
  const start15m = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const start1h = new Date(end.getTime() - 60 * 24 * 60 * 60 * 1000);
  const start1d = new Date(end.getTime() - 250 * 24 * 60 * 60 * 1000);

  const [candles15m, candles1h, candlesDaily, upcomingNews] = await Promise.all([
    fetchYahooCandles(symbol, start15m, end, "15m"),
    fetchYahooCandles(symbol, start1h, end, "1h"),
    fetchYahooCandles(symbol, start1d, end, "1d"),
    fetchUpcomingNews(),
  ]);

  return {
    candles15m,
    candles1h,
    candles4h: aggregateTo4h(candles1h),
    candlesDaily,
    upcomingNews,
  };
}
