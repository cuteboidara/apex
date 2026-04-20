import type { SniperCandle } from "@/src/sniper/types/sniperTypes";
import { getSniperCache, setSniperCache } from "@/src/sniper/data/cache/sniperCache";

type YahooInterval = "15m" | "1h";

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
  return interval === "15m" ? "15m" : "60m";
}

function toNumber(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function parseCandles(payload: YahooResponse): SniperCandle[] {
  const row = payload.chart?.result?.[0];
  if (!row) return [];

  const ts = row.timestamp ?? [];
  const quote = row.indicators?.quote?.[0] ?? {};

  const candles: SniperCandle[] = [];
  for (let i = 0; i < ts.length; i += 1) {
    const stamp = ts[i];
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

export async function fetchCandles(
  symbol: string,
  start: Date,
  end: Date,
  interval: YahooInterval,
): Promise<SniperCandle[]> {
  const cacheKey = `sniper:${symbol}:${interval}:${Math.floor(start.getTime() / 60000)}:${Math.floor(end.getTime() / 60000)}`;
  const cached = getSniperCache<SniperCandle[]>(cacheKey);
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
          signal: AbortSignal.timeout(10_000),
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
          },
        },
      );

      if (!response.ok) continue;
      const payload = await response.json() as YahooResponse;
      const candles = parseCandles(payload);
      setSniperCache(cacheKey, candles, 60_000);
      return candles;
    } catch {
      continue;
    }
  }

  return [];
}

