import type { Candle } from "@/src/smc/types";
import type { CryptoSymbol } from "@/src/crypto/config/cryptoScope";
import { CRYPTO_ACTIVE_SYMBOLS } from "@/src/crypto/config/cryptoScope";
import { BINANCE_KLINE_INTERVAL, BINANCE_KLINE_LIMIT } from "@/src/crypto/data/binanceSymbols";
import { fetchCryptoSpotQuote } from "@/src/crypto/data/marketUniverse";

const BINANCE_REST_BASE = "https://api.binance.com/api/v3";
const CANDLE_CACHE_TTL_MS = 60_000;

type CachedCandles = {
  candles: Candle[];
  fetchedAt: number;
};

const globalForCryptoData = globalThis as typeof globalThis & {
  __apexCryptoCandleCache?: Map<CryptoSymbol, CachedCandles>;
};

const candleCache = globalForCryptoData.__apexCryptoCandleCache ??= new Map<CryptoSymbol, CachedCandles>();

function parseKline(raw: unknown[]): Candle {
  return {
    time: Math.floor(Number(raw[0]) / 1000),
    open: Number(raw[1]),
    high: Number(raw[2]),
    low: Number(raw[3]),
    close: Number(raw[4]),
    volume: Number(raw[5]),
  };
}

export async function fetchCryptoCandles(symbol: CryptoSymbol): Promise<Candle[]> {
  const cached = candleCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL_MS) {
    return cached.candles;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(
      `${BINANCE_REST_BASE}/klines?symbol=${symbol}&interval=${BINANCE_KLINE_INTERVAL}&limit=${BINANCE_KLINE_LIMIT}`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Binance candle fetch failed: ${response.status} for ${symbol}`);
    }

    const raw = await response.json() as unknown[][];
    const candles = raw.map(parseKline);
    candleCache.set(symbol, {
      candles,
      fetchedAt: Date.now(),
    });
    return candles;
  } catch (error) {
    console.error(`[crypto-data] Failed to fetch candles for ${symbol}:`, error);
    return candleCache.get(symbol)?.candles ?? [];
  }
}

export async function fetchAllCryptoCandles(): Promise<Record<CryptoSymbol, Candle[]>> {
  const results = await Promise.allSettled(
    CRYPTO_ACTIVE_SYMBOLS.map(async symbol => ({
      symbol,
      candles: await fetchCryptoCandles(symbol),
    })),
  );

  const output = {} as Record<CryptoSymbol, Candle[]>;
  for (const symbol of CRYPTO_ACTIVE_SYMBOLS) {
    output[symbol] = [];
  }

  for (const result of results) {
    if (result.status === "fulfilled") {
      output[result.value.symbol] = result.value.candles;
    }
  }

  return output;
}

export async function fetchCryptoTickerPrice(symbol: CryptoSymbol): Promise<number | null> {
  try {
    const quote = await fetchCryptoSpotQuote(symbol);
    return quote?.lastPrice ?? null;
  } catch {
    return null;
  }
}

export function resetCryptoDataPlantForTests(): void {
  candleCache.clear();
}
