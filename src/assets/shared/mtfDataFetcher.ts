import type { MTFCandles } from "@/src/assets/shared/mtfAnalysis";
import type { Candle } from "@/src/assets/shared/types";
import { resolveYahooSymbol } from "@/src/lib/yahooFinance";

const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
] as const;

const REQUEST_TIMEOUT_MS = 8_000;

const FALLBACK_SYMBOL_MAP: Record<string, string> = {
  XAUUSD: "GC=F",
  XAGUSD: "SI=F",
  USDJPY: "JPY=X",
  USDCAD: "CAD=X",
  USDCHF: "CHF=X",
  BTCUSDT: "BTC-USD",
  ETHUSDT: "ETH-USD",
  SOLUSDT: "SOL-USD",
  BNBUSDT: "BNB-USD",
  XRPUSDT: "XRP-USD",
  DOGEUSDT: "DOGE-USD",
  ADAUSDT: "ADA-USD",
  AVAXUSDT: "AVAX-USD",
};

const CANONICAL_YAHOO_ALIASES: Record<string, string> = {
  "GC=F": "XAUUSD",
  GOLD: "XAUUSD",
  "XAU/USD": "XAUUSD",
};

function normalizeApexSymbol(symbol: string): string {
  return CANONICAL_YAHOO_ALIASES[symbol.toUpperCase()] ?? symbol;
}

function toYahooSymbol(symbol: string): string | null {
  const normalized = normalizeApexSymbol(symbol);
  return FALLBACK_SYMBOL_MAP[normalized] ?? resolveYahooSymbol(normalized);
}

function aggregateCandles(candles: Candle[], bucketMs: number): Candle[] {
  if (candles.length === 0) {
    return [];
  }

  const grouped = new Map<number, Candle[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.time / bucketMs) * bucketMs;
    if (!grouped.has(bucket)) {
      grouped.set(bucket, []);
    }
    grouped.get(bucket)?.push(candle);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucket, group]) => ({
      time: bucket,
      open: group[0]?.open ?? group[0]?.close ?? 0,
      high: Math.max(...group.map(candle => candle.high)),
      low: Math.min(...group.map(candle => candle.low)),
      close: group.at(-1)?.close ?? group[0]?.close ?? 0,
      volume: group.reduce((sum, candle) => sum + (candle.volume ?? 0), 0),
    }))
    .filter(candle =>
      Number.isFinite(candle.open)
      && Number.isFinite(candle.high)
      && Number.isFinite(candle.low)
      && Number.isFinite(candle.close)
      && candle.open > 0
      && candle.high > 0
      && candle.low > 0
      && candle.close > 0,
    );
}

async function fetchYahooTF(
  symbol: string,
  interval: string,
  range: string,
): Promise<Candle[]> {
  const yahooSymbol = toYahooSymbol(symbol);
  if (!yahooSymbol) {
    return [];
  }

  for (const host of YAHOO_HOSTS) {
    try {
      const response = await fetch(
        `${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=${interval}&range=${range}&includePrePost=false`,
        {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        continue;
      }

      const payload = await response.json() as {
        chart?: {
          result?: Array<{
            timestamp?: Array<number | null>;
            indicators?: {
              quote?: Array<{
                open?: Array<number | null>;
                high?: Array<number | null>;
                low?: Array<number | null>;
                close?: Array<number | null>;
                volume?: Array<number | null>;
              }>;
            };
          }> | null;
        };
      };

      const result = payload.chart?.result?.[0];
      const timestamps = result?.timestamp ?? [];
      const quote = result?.indicators?.quote?.[0];
      if (!quote || timestamps.length === 0) {
        continue;
      }

      const candles: Candle[] = [];
      for (let index = 0; index < timestamps.length; index += 1) {
        const timestamp = timestamps[index];
        const open = quote.open?.[index];
        const high = quote.high?.[index];
        const low = quote.low?.[index];
        const close = quote.close?.[index];
        const volume = quote.volume?.[index];
        if (
          timestamp == null
          || open == null || !Number.isFinite(open) || open <= 0
          || high == null || !Number.isFinite(high) || high <= 0
          || low == null || !Number.isFinite(low) || low <= 0
          || close == null || !Number.isFinite(close) || close <= 0
        ) {
          continue;
        }

        candles.push({
          time: timestamp * 1000,
          open,
          high,
          low,
          close,
          volume: typeof volume === "number" && Number.isFinite(volume) ? volume : 0,
        });
      }

      if (candles.length > 0) {
        return candles;
      }
    } catch {
      continue;
    }
  }

  return [];
}

export async function fetchMTFCandles(symbol: string): Promise<MTFCandles> {
  const [monthly, weekly, daily, h1, m15, m5] = await Promise.all([
    fetchYahooTF(symbol, "1mo", "5y"),
    fetchYahooTF(symbol, "1wk", "2y"),
    fetchYahooTF(symbol, "1d", "6mo"),
    fetchYahooTF(symbol, "1h", "30d"),
    fetchYahooTF(symbol, "15m", "8d"),
    fetchYahooTF(symbol, "5m", "5d"),
  ]);

  const h4 = aggregateCandles(h1, 4 * 60 * 60 * 1000);

  console.log(
    `[MTF] ${symbol}: mo=${monthly.length} wk=${weekly.length} d=${daily.length} h4=${h4.length} h1=${h1.length} m15=${m15.length} m5=${m5.length}`,
  );

  return {
    monthly,
    weekly,
    daily,
    h4,
    h1,
    m15,
    m5,
  };
}
