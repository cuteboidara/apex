import { NextResponse } from "next/server";

import { getCachedJson, setCachedJson } from "@/src/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StockSector = "tech" | "finance" | "energy";
type MarketStatus = "open" | "closed" | "pre" | "after";

type StockDefinition = {
  symbol: string;
  label: string;
  sector: StockSector;
};

type StockPriceRow = {
  symbol: string;
  label: string;
  sector: StockSector;
  price: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap?: number | null;
  provider: string;
  freshAt: number;
  marketStatus: MarketStatus;
  stale?: boolean;
  reason?: string | null;
};

type StockPricesPayload = {
  generatedAt: number;
  marketStatus: MarketStatus;
  assets: StockPriceRow[];
};

const CACHE_KEY = "stocks:prices:live";
const CACHE_TTL_SECONDS = 15;

const STOCKS: StockDefinition[] = [
  { symbol: "AAPL", label: "Apple", sector: "tech" },
  { symbol: "MSFT", label: "Microsoft", sector: "tech" },
  { symbol: "NVDA", label: "Nvidia", sector: "tech" },
  { symbol: "GOOGL", label: "Google", sector: "tech" },
  { symbol: "META", label: "Meta", sector: "tech" },
  { symbol: "AMZN", label: "Amazon", sector: "tech" },
  { symbol: "TSLA", label: "Tesla", sector: "tech" },
  { symbol: "JPM", label: "JPMorgan", sector: "finance" },
  { symbol: "GS", label: "Goldman", sector: "finance" },
  { symbol: "BAC", label: "Bank of America", sector: "finance" },
  { symbol: "XOM", label: "ExxonMobil", sector: "energy" },
  { symbol: "CVX", label: "Chevron", sector: "energy" },
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

function getEasternParts(now: number): { day: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date(now));
  const weekday = parts.find(part => part.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? "0");
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: dayMap[weekday] ?? 1,
    minutes: hour * 60 + minute,
  };
}

function getMarketStatus(now: number): MarketStatus {
  const eastern = getEasternParts(now);
  if (eastern.day === 0 || eastern.day === 6) {
    return "closed";
  }
  if (eastern.minutes >= 9 * 60 + 30 && eastern.minutes < 16 * 60) {
    return "open";
  }
  if (eastern.minutes >= 4 * 60 && eastern.minutes < 9 * 60 + 30) {
    return "pre";
  }
  if (eastern.minutes >= 16 * 60 && eastern.minutes < 20 * 60) {
    return "after";
  }
  return "closed";
}

function createRow(input: {
  definition: StockDefinition;
  price: number | null;
  previousClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap?: number | null;
  provider: string;
  freshAt?: number;
  stale?: boolean;
  reason?: string | null;
}): StockPriceRow {
  const change = input.price != null && input.previousClose != null ? input.price - input.previousClose : null;
  const changePct = change != null && input.previousClose != null && input.previousClose !== 0
    ? (change / input.previousClose) * 100
    : null;

  return {
    symbol: input.definition.symbol,
    label: input.definition.label,
    sector: input.definition.sector,
    price: input.price,
    change,
    changePct,
    direction: change == null || change === 0 ? "flat" : change > 0 ? "up" : "down",
    open: input.open,
    high: input.high,
    low: input.low,
    volume: input.volume,
    marketCap: input.marketCap ?? null,
    provider: input.provider,
    freshAt: input.freshAt ?? Date.now(),
    marketStatus: getMarketStatus(Date.now()),
    stale: input.stale ?? false,
    reason: input.reason ?? null,
  };
}

async function fetchYahooRow(definition: StockDefinition): Promise<StockPriceRow | null> {
  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ] as const;

  for (const host of hosts) {
    try {
      const response = await fetch(
        `${host}/v8/finance/chart/${encodeURIComponent(definition.symbol)}?interval=1d&range=5d&includePrePost=true`,
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
              previousClose?: number;
              chartPreviousClose?: number;
            };
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
      if (!result) {
        continue;
      }

      const quote = result.indicators?.quote?.[0];
      const opens = (quote?.open ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
      const highs = (quote?.high ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
      const lows = (quote?.low ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
      const closes = (quote?.close ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
      const volumes = (quote?.volume ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);

      const price = parseNumber(result.meta?.regularMarketPrice) ?? closes[closes.length - 1] ?? null;
      const previousClose = parseNumber(result.meta?.previousClose)
        ?? parseNumber(result.meta?.chartPreviousClose)
        ?? (closes.length >= 2 ? closes[closes.length - 2] : closes[0] ?? null);

      if (price == null) {
        continue;
      }

      return createRow({
        definition,
        price,
        previousClose,
        open: opens[opens.length - 1] ?? null,
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

async function buildRow(definition: StockDefinition, cachedRow?: StockPriceRow): Promise<StockPriceRow> {
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
      marketStatus: getMarketStatus(Date.now()),
    };
  }

  return createRow({
    definition,
    price: null,
    previousClose: null,
    open: null,
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
  const cached = await getCachedJson<StockPricesPayload>(CACHE_KEY);
  const cachedMap = new Map((cached?.assets ?? []).map(asset => [asset.symbol, asset]));
  const assets = await Promise.all(STOCKS.map(definition => buildRow(definition, cachedMap.get(definition.symbol))));
  const payload: StockPricesPayload = {
    generatedAt: Date.now(),
    marketStatus: getMarketStatus(Date.now()),
    assets,
  };

  await setCachedJson(CACHE_KEY, payload, CACHE_TTL_SECONDS);
  return NextResponse.json(payload);
}
