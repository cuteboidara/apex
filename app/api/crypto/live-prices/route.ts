import { NextResponse } from "next/server";

import { getCachedJson, setCachedJson } from "@/src/lib/redis";
import { fetchCryptoSpotQuotes } from "@/src/crypto/data/marketUniverse";
import { getCryptoSignalsPayload } from "@/src/crypto/engine/cryptoRuntime";
import { selectTradableAssets } from "@/src/crypto/engine/CryptoEngine";
import type { CryptoSelectedAsset } from "@/src/crypto/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  provider: string;
  freshAt: number;
  stale?: boolean;
  reason?: string | null;
};

type CryptoPricesPayload = {
  generatedAt: number;
  selectionGeneratedAt: number | null;
  selectionProvider: string | null;
  assets: CryptoPriceRow[];
};

const CACHE_KEY = "crypto:prices:live";
const CACHE_TTL_SECONDS = 10;

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
  asset: CryptoSelectedAsset;
  price: number | null;
  change24h: number | null;
  changePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  marketCap?: number | null;
  provider: string;
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

export async function GET() {
  const cached = await getCachedJson<CryptoPricesPayload>(CACHE_KEY);
  const livePayload = getCryptoSignalsPayload();
  const selection = livePayload.selectedAssets.length > 0
    ? {
      generatedAt: livePayload.selectionGeneratedAt ?? livePayload.generatedAt,
      provider: livePayload.selectionProvider ?? "runtime",
      assets: livePayload.selectedAssets,
    }
    : await selectTradableAssets();

  let liveQuoteMap = new Map<string, CryptoPriceRow>();
  try {
    const quoteSnapshot = await fetchCryptoSpotQuotes(selection.assets.map(asset => asset.symbol));
    liveQuoteMap = new Map(selection.assets.map(asset => {
      const quote = quoteSnapshot.rows.get(asset.symbol);
      return quote == null
        ? [asset.symbol, null]
        : [asset.symbol, createRow({
          asset,
          price: quote.lastPrice,
          change24h: quote.change24h,
          changePct24h: quote.priceChangePct24h,
          high24h: quote.high24h,
          low24h: quote.low24h,
          volume24h: quote.quoteVolume24h,
          marketCap: quote.marketCap,
          provider: quote.provider,
        })];
    }).filter((entry): entry is [string, CryptoPriceRow] => entry[1] != null));
  } catch (error) {
    console.error("[api/crypto/live-prices] live quote fetch failed:", error);
  }

  const cachedMap = new Map((cached?.assets ?? []).map(asset => [asset.symbol, asset]));
  const assets = selection.assets.map(asset => {
    const live = liveQuoteMap.get(asset.symbol);
    if (live) {
      return live;
    }

    if (cachedMap.has(asset.symbol)) {
      return {
        ...cachedMap.get(asset.symbol)!,
        label: asset.label,
        short: asset.short,
        stale: true,
      };
    }

    return createRow({
      asset,
      price: asset.lastPrice,
      change24h: null,
      changePct24h: asset.priceChangePct24h,
      high24h: null,
      low24h: null,
      volume24h: asset.quoteVolume24h,
      provider: selection.provider,
      stale: true,
      reason: "Crypto market data unavailable",
    });
  });

  const payload: CryptoPricesPayload = {
    generatedAt: Date.now(),
    selectionGeneratedAt: selection.generatedAt,
    selectionProvider: selection.provider,
    assets,
  };

  await setCachedJson(CACHE_KEY, payload, CACHE_TTL_SECONDS);
  return NextResponse.json(payload);
}
