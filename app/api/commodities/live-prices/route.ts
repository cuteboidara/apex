import { NextResponse } from "next/server";

import { getCachedJson, setCachedJson } from "@/src/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CommodityCategory = "metals" | "energy";

type CommodityDefinition = {
  symbol: string;
  label: string;
  category: CommodityCategory;
  unit: string;
  yahooSymbol: string;
};

type CommodityPriceRow = {
  symbol: string;
  label: string;
  category: CommodityCategory;
  unit: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  high: number | null;
  low: number | null;
  volume: number | null;
  provider: string;
  freshAt: number;
  stale?: boolean;
  reason?: string | null;
};

type CommodityPricesPayload = {
  generatedAt: number;
  assets: CommodityPriceRow[];
};

const CACHE_KEY = "commodities:prices:live";
const CACHE_TTL_SECONDS = 30;

const COMMODITIES: CommodityDefinition[] = [
  { symbol: "XAUUSD", label: "XAUUSD", category: "metals", unit: "troy oz", yahooSymbol: "GC=F" },
  { symbol: "XAGUSD", label: "Silver", category: "metals", unit: "troy oz", yahooSymbol: "SI=F" },
  { symbol: "WTICOUSD", label: "WTI Oil", category: "energy", unit: "barrel", yahooSymbol: "CL=F" },
  { symbol: "BCOUSD", label: "Brent Oil", category: "energy", unit: "barrel", yahooSymbol: "BZ=F" },
  { symbol: "NATGASUSD", label: "Natural Gas", category: "energy", unit: "MMBtu", yahooSymbol: "NG=F" },
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
  definition: CommodityDefinition;
  price: number | null;
  previousClose: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  provider: string;
  freshAt?: number;
  stale?: boolean;
  reason?: string | null;
}): CommodityPriceRow {
  const change = input.price != null && input.previousClose != null ? input.price - input.previousClose : null;
  const changePct = change != null && input.previousClose != null && input.previousClose !== 0
    ? (change / input.previousClose) * 100
    : null;

  return {
    symbol: input.definition.symbol,
    label: input.definition.label,
    category: input.definition.category,
    unit: input.definition.unit,
    price: input.price,
    change,
    changePct,
    direction: change == null || change === 0 ? "flat" : change > 0 ? "up" : "down",
    high: input.high,
    low: input.low,
    volume: input.volume,
    provider: input.provider,
    freshAt: input.freshAt ?? Date.now(),
    stale: input.stale ?? false,
    reason: input.reason ?? null,
  };
}

async function fetchYahooRow(definition: CommodityDefinition): Promise<CommodityPriceRow | null> {
  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ] as const;

  for (const host of hosts) {
    try {
      const response = await fetch(
        `${host}/v8/finance/chart/${encodeURIComponent(definition.yahooSymbol)}?interval=1d&range=5d&includePrePost=false`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(8_000),
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "application/json",
          },
        },
      );
      if (!response.ok) {
        continue;
      }

      const payload = await response.json() as {
        chart?: {
          result?: Array<{
            meta?: {
              regularMarketPrice?: number;
              chartPreviousClose?: number;
            };
            indicators?: {
              quote?: Array<{
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
      if (!result) {
        continue;
      }

      const quote = result.indicators?.quote?.[0];
      const closes = (quote?.close ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
      const highs = (quote?.high ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
      const lows = (quote?.low ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
      const volumes = (quote?.volume ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);

      const price = parseNumber(result.meta?.regularMarketPrice) ?? closes[closes.length - 1] ?? null;
      const previousClose = parseNumber(result.meta?.chartPreviousClose)
        ?? (closes.length >= 2 ? closes[closes.length - 2] : closes[0] ?? null);

      if (price == null) {
        continue;
      }

      return createRow({
        definition,
        price,
        previousClose,
        high: highs[highs.length - 1] ?? null,
        low: lows[lows.length - 1] ?? null,
        volume: volumes[volumes.length - 1] ?? null,
        provider: "yahoo",
        freshAt: Date.now(),
      });
    } catch {
      continue;
    }
  }

  return null;
}

async function buildRow(definition: CommodityDefinition, cachedRow?: CommodityPriceRow): Promise<CommodityPriceRow> {
  const yahooRow = await fetchYahooRow(definition).catch(() => null);
  if (yahooRow) {
    return yahooRow;
  }

  if (cachedRow) {
    return {
      ...cachedRow,
      stale: true,
      reason: null,
      freshAt: cachedRow.freshAt,
    };
  }

  return createRow({
    definition,
    price: null,
    previousClose: null,
    high: null,
    low: null,
    volume: null,
    provider: "cache",
    stale: true,
    reason: "Yahoo Finance unavailable",
    freshAt: Date.now(),
  });
}

export async function GET() {
  const cached = await getCachedJson<CommodityPricesPayload>(CACHE_KEY);
  const cachedMap = new Map((cached?.assets ?? []).map(asset => [asset.symbol, asset]));

  const assets = await Promise.all(COMMODITIES.map(definition => buildRow(definition, cachedMap.get(definition.symbol))));
  const payload: CommodityPricesPayload = {
    generatedAt: Date.now(),
    assets,
  };

  await setCachedJson(CACHE_KEY, payload, CACHE_TTL_SECONDS);
  return NextResponse.json(payload);
}
