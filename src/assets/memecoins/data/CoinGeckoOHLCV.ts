import type { Candle } from "@/src/smc/types";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const COINGECKO_PRO_BASE = "https://pro-api.coingecko.com/api/v3";

export interface CoinGeckoMarketData {
  id: string;
  name: string;
  symbol: string;
  current_price: number;
  market_cap: number;
  total_volume: number;
  price_change_percentage_24h: number;
  price_change_percentage_1h_in_currency: number;
  market_cap_rank: number;
}

function getBase(): string {
  return process.env.COINGECKO_API_KEY ? COINGECKO_PRO_BASE : COINGECKO_BASE;
}

function getHeaders(): HeadersInit {
  const headers: HeadersInit = { Accept: "application/json" };
  if (process.env.COINGECKO_API_KEY) {
    headers["x-cg-pro-api-key"] = process.env.COINGECKO_API_KEY;
  }
  return headers;
}

export async function fetchCoinGeckoOHLCV(
  coingeckoId: string,
  days = 1,
): Promise<Candle[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(`${getBase()}/coins/${coingeckoId}/ohlc?vs_currency=usd&days=${days}`, {
      headers: getHeaders(),
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      console.error(`[coingecko-ohlcv] Failed for ${coingeckoId}: ${response.status}`);
      return [];
    }

    const data = await response.json() as Array<[number, number, number, number, number]>;
    return data.map(([timestamp, open, high, low, close]) => ({
      time: Math.floor(timestamp / 1000),
      open,
      high,
      low,
      close,
      volume: 0,
    }));
  } catch (error) {
    console.error(`[coingecko-ohlcv] Error for ${coingeckoId}:`, error);
    return [];
  }
}

export async function fetchCoinGeckoPrice(coingeckoId: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(`${getBase()}/simple/price?ids=${coingeckoId}&vs_currencies=usd`, {
      headers: getHeaders(),
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as Record<string, { usd?: number }>;
    return data[coingeckoId]?.usd ?? null;
  } catch {
    return null;
  }
}

export async function fetchCoinGeckoMarketData(ids: string[]): Promise<CoinGeckoMarketData[]> {
  if (ids.length === 0) {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(
      `${getBase()}/coins/markets?vs_currency=usd&ids=${ids.join(",")}&price_change_percentage=1h,24h&order=market_cap_desc`,
      {
        headers: getHeaders(),
        signal: controller.signal,
      },
    ).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      return [];
    }

    return await response.json() as CoinGeckoMarketData[];
  } catch {
    return [];
  }
}
