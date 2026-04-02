import { NextResponse } from "next/server";

import { getCachedJson, setCachedJson } from "@/src/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CryptoDefinition = {
  symbol: string;
  label: string;
  short: string;
  tv: string;
  coingeckoId: string;
};

type CryptoPriceRow = {
  symbol: string;
  label: string;
  short: string;
  price: number | null;
  change24h: number | null;
  changePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  marketCap?: number | null;
  direction: "up" | "down" | "flat";
  provider: "binance" | "coingecko";
  freshAt: number;
  stale?: boolean;
  reason?: string | null;
};

type CryptoPricesPayload = {
  generatedAt: number;
  assets: CryptoPriceRow[];
};

const CACHE_KEY = "crypto:prices:live";
const CACHE_TTL_SECONDS = 10;

const CRYPTO_ASSETS: CryptoDefinition[] = [
  { symbol: "BTCUSDT", label: "Bitcoin", short: "BTC", tv: "BINANCE:BTCUSDT", coingeckoId: "bitcoin" },
  { symbol: "ETHUSDT", label: "Ethereum", short: "ETH", tv: "BINANCE:ETHUSDT", coingeckoId: "ethereum" },
  { symbol: "SOLUSDT", label: "Solana", short: "SOL", tv: "BINANCE:SOLUSDT", coingeckoId: "solana" },
  { symbol: "BNBUSDT", label: "BNB", short: "BNB", tv: "BINANCE:BNBUSDT", coingeckoId: "binancecoin" },
  { symbol: "XRPUSDT", label: "XRP", short: "XRP", tv: "BINANCE:XRPUSDT", coingeckoId: "ripple" },
  { symbol: "DOGEUSDT", label: "Dogecoin", short: "DOGE", tv: "BINANCE:DOGEUSDT", coingeckoId: "dogecoin" },
  { symbol: "ADAUSDT", label: "Cardano", short: "ADA", tv: "BINANCE:ADAUSDT", coingeckoId: "cardano" },
  { symbol: "AVAXUSDT", label: "Avalanche", short: "AVAX", tv: "BINANCE:AVAXUSDT", coingeckoId: "avalanche-2" },
];

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function createRow(input: {
  asset: CryptoDefinition;
  price: number | null;
  change24h: number | null;
  changePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  marketCap?: number | null;
  provider: "binance" | "coingecko";
  stale?: boolean;
  reason?: string | null;
}): CryptoPriceRow {
  const direction = input.change24h == null || input.change24h === 0 ? "flat" : input.change24h > 0 ? "up" : "down";
  return {
    symbol: input.asset.symbol,
    label: input.asset.label,
    short: input.asset.short,
    price: input.price,
    change24h: input.change24h,
    changePct24h: input.changePct24h,
    high24h: input.high24h,
    low24h: input.low24h,
    volume24h: input.volume24h,
    marketCap: input.marketCap ?? null,
    direction,
    provider: input.provider,
    freshAt: Date.now(),
    stale: input.stale ?? false,
    reason: input.reason ?? null,
  };
}

async function fetchBinanceRows(): Promise<Map<string, CryptoPriceRow>> {
  const symbols = CRYPTO_ASSETS.map(asset => asset.symbol);
  const url = new URL("https://api.binance.com/api/v3/ticker/24hr");
  url.searchParams.set("symbols", JSON.stringify(symbols));

  const response = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Binance 24hr ticker failed with ${response.status}`);
  }

  const payload = await response.json() as Array<{
    symbol?: string;
    lastPrice?: string;
    priceChange?: string;
    priceChangePercent?: string;
    highPrice?: string;
    lowPrice?: string;
    quoteVolume?: string;
  }>;

  const rows = new Map<string, CryptoPriceRow>();
  for (const item of payload) {
    const asset = CRYPTO_ASSETS.find(candidate => candidate.symbol === item.symbol);
    if (!asset) {
      continue;
    }
    rows.set(asset.symbol, createRow({
      asset,
      price: parseNumber(item.lastPrice),
      change24h: parseNumber(item.priceChange),
      changePct24h: parseNumber(item.priceChangePercent),
      high24h: parseNumber(item.highPrice),
      low24h: parseNumber(item.lowPrice),
      volume24h: parseNumber(item.quoteVolume),
      provider: "binance",
    }));
  }
  return rows;
}

async function fetchCoinGeckoRows(): Promise<Map<string, Partial<CryptoPriceRow>>> {
  const ids = CRYPTO_ASSETS.map(asset => asset.coingeckoId).join(",");
  const url = new URL("https://api.coingecko.com/api/v3/coins/markets");
  url.searchParams.set("vs_currency", "usd");
  url.searchParams.set("ids", ids);
  url.searchParams.set("price_change_percentage", "24h");

  const response = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`CoinGecko markets failed with ${response.status}`);
  }

  const payload = await response.json() as Array<{
    id?: string;
    current_price?: number;
    price_change_24h?: number;
    price_change_percentage_24h?: number;
    high_24h?: number;
    low_24h?: number;
    total_volume?: number;
    market_cap?: number;
  }>;

  const rows = new Map<string, Partial<CryptoPriceRow>>();
  for (const item of payload) {
    const asset = CRYPTO_ASSETS.find(candidate => candidate.coingeckoId === item.id);
    if (!asset) {
      continue;
    }
    rows.set(asset.symbol, {
      symbol: asset.symbol,
      label: asset.label,
      short: asset.short,
      price: item.current_price ?? null,
      change24h: item.price_change_24h ?? null,
      changePct24h: item.price_change_percentage_24h ?? null,
      high24h: item.high_24h ?? null,
      low24h: item.low_24h ?? null,
      volume24h: item.total_volume ?? null,
      marketCap: item.market_cap ?? null,
      direction: item.price_change_24h == null || item.price_change_24h === 0 ? "flat" : item.price_change_24h > 0 ? "up" : "down",
      provider: "coingecko",
      freshAt: Date.now(),
    });
  }
  return rows;
}

export async function GET() {
  const cached = await getCachedJson<CryptoPricesPayload>(CACHE_KEY);

  const [binanceRows, coingeckoRows] = await Promise.allSettled([
    fetchBinanceRows(),
    fetchCoinGeckoRows(),
  ]);

  const binanceMap = binanceRows.status === "fulfilled" ? binanceRows.value : new Map<string, CryptoPriceRow>();
  const coingeckoMap = coingeckoRows.status === "fulfilled" ? coingeckoRows.value : new Map<string, Partial<CryptoPriceRow>>();
  const cachedMap = new Map((cached?.assets ?? []).map(asset => [asset.symbol, asset]));

  const assets = CRYPTO_ASSETS.map(asset => {
    const binance = binanceMap.get(asset.symbol);
    const coingecko = coingeckoMap.get(asset.symbol);
    const cachedRow = cachedMap.get(asset.symbol);

    if (binance) {
      return {
        ...binance,
        marketCap: coingecko?.marketCap ?? binance.marketCap ?? null,
      };
    }

    if (coingecko) {
      return createRow({
        asset,
        price: coingecko.price ?? null,
        change24h: coingecko.change24h ?? null,
        changePct24h: coingecko.changePct24h ?? null,
        high24h: coingecko.high24h ?? null,
        low24h: coingecko.low24h ?? null,
        volume24h: coingecko.volume24h ?? null,
        marketCap: coingecko.marketCap ?? null,
        provider: "coingecko",
        stale: false,
      });
    }

    if (cachedRow?.price != null) {
      return {
        ...cachedRow,
        stale: true,
        reason: null,
      };
    }

    return createRow({
      asset,
      price: null,
      change24h: null,
      changePct24h: null,
      high24h: null,
      low24h: null,
      volume24h: null,
      marketCap: null,
      provider: "coingecko",
      stale: true,
      reason: "Crypto market data unavailable",
    });
  });

  const payload: CryptoPricesPayload = {
    generatedAt: Date.now(),
    assets,
  };

  await setCachedJson(CACHE_KEY, payload, CACHE_TTL_SECONDS);
  return NextResponse.json(payload);
}
