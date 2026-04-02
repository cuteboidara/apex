import { NextResponse } from "next/server";

import { fetchStooqIndexCandles } from "@/src/assets/indices/data/StooqIndicesPlant";
import { getCachedJson, setCachedJson } from "@/src/lib/redis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type IndexRegion = "us" | "europe" | "asia";

type IndexDefinition = {
  symbol: string;
  label: string;
  region: IndexRegion;
  tv: string;
  internalAlias?: "SPX" | "NDX" | "DJI" | "UKX" | "DAX" | "NKY";
  timezone: string;
  openMinutes: number;
  closeMinutes: number;
};

type IndexPriceRow = {
  symbol: string;
  label: string;
  region: IndexRegion;
  price: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  high: number | null;
  low: number | null;
  provider: string;
  freshAt: number;
  marketStatus: "open" | "closed";
  stale?: boolean;
  reason?: string | null;
};

type IndexPricesPayload = {
  generatedAt: number;
  assets: IndexPriceRow[];
};

const CACHE_KEY = "indices:prices:live";
const CACHE_TTL_SECONDS = 30;

const INDICES: IndexDefinition[] = [
  { symbol: "^GSPC", label: "S&P 500", region: "us", tv: "SP:SPX", internalAlias: "SPX", timezone: "America/New_York", openMinutes: 9 * 60 + 30, closeMinutes: 16 * 60 },
  { symbol: "^DJI", label: "Dow Jones", region: "us", tv: "DJ:DJI", internalAlias: "DJI", timezone: "America/New_York", openMinutes: 9 * 60 + 30, closeMinutes: 16 * 60 },
  { symbol: "^IXIC", label: "Nasdaq 100", region: "us", tv: "NASDAQ:NDX", internalAlias: "NDX", timezone: "America/New_York", openMinutes: 9 * 60 + 30, closeMinutes: 16 * 60 },
  { symbol: "^RUT", label: "Russell 2000", region: "us", tv: "TVC:RUT", timezone: "America/New_York", openMinutes: 9 * 60 + 30, closeMinutes: 16 * 60 },
  { symbol: "^FTSE", label: "FTSE 100", region: "europe", tv: "TVC:UKX", internalAlias: "UKX", timezone: "Europe/London", openMinutes: 8 * 60, closeMinutes: 16 * 60 + 30 },
  { symbol: "^GDAXI", label: "DAX", region: "europe", tv: "XETR:DAX", internalAlias: "DAX", timezone: "Europe/Berlin", openMinutes: 9 * 60, closeMinutes: 17 * 60 + 30 },
  { symbol: "^FCHI", label: "CAC 40", region: "europe", tv: "EURONEXT:PX1", timezone: "Europe/Paris", openMinutes: 9 * 60, closeMinutes: 17 * 60 + 30 },
  { symbol: "^N225", label: "Nikkei 225", region: "asia", tv: "TVC:NI225", internalAlias: "NKY", timezone: "Asia/Tokyo", openMinutes: 9 * 60, closeMinutes: 15 * 60 },
  { symbol: "^HSI", label: "Hang Seng", region: "asia", tv: "TVC:HSI", timezone: "Asia/Hong_Kong", openMinutes: 9 * 60 + 30, closeMinutes: 16 * 60 },
  { symbol: "^AXJO", label: "ASX 200", region: "asia", tv: "ASX:XJO", timezone: "Australia/Sydney", openMinutes: 10 * 60, closeMinutes: 16 * 60 },
  { symbol: "DX-Y.NYB", label: "DXY", region: "us", tv: "TVC:DXY", timezone: "America/New_York", openMinutes: 9 * 60 + 30, closeMinutes: 16 * 60 },
  { symbol: "^VIX", label: "VIX", region: "us", tv: "TVC:VIX", timezone: "America/New_York", openMinutes: 9 * 60 + 30, closeMinutes: 16 * 60 },
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

function getLocalParts(now: number, timeZone: string): { day: number; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
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

function getMarketStatus(definition: IndexDefinition): "open" | "closed" {
  const local = getLocalParts(Date.now(), definition.timezone);
  if (local.day === 0 || local.day === 6) {
    return "closed";
  }
  return local.minutes >= definition.openMinutes && local.minutes < definition.closeMinutes
    ? "open"
    : "closed";
}

function createRow(input: {
  definition: IndexDefinition;
  price: number | null;
  previousClose: number | null;
  high: number | null;
  low: number | null;
  provider: string;
  freshAt?: number;
  stale?: boolean;
  reason?: string | null;
}): IndexPriceRow {
  const change = input.price != null && input.previousClose != null ? input.price - input.previousClose : null;
  const changePct = change != null && input.previousClose != null && input.previousClose !== 0
    ? (change / input.previousClose) * 100
    : null;

  return {
    symbol: input.definition.symbol,
    label: input.definition.label,
    region: input.definition.region,
    price: input.price,
    change,
    changePct,
    direction: change == null || change === 0 ? "flat" : change > 0 ? "up" : "down",
    high: input.high,
    low: input.low,
    provider: input.provider,
    freshAt: input.freshAt ?? Date.now(),
    marketStatus: getMarketStatus(input.definition),
    stale: input.stale ?? false,
    reason: input.reason ?? null,
  };
}

async function fetchStooqRow(definition: IndexDefinition): Promise<IndexPriceRow | null> {
  if (!definition.internalAlias) {
    return null;
  }

  const candles = await fetchStooqIndexCandles(definition.internalAlias, 5);
  const latest = candles[candles.length - 1];
  const previous = candles.length >= 2 ? candles[candles.length - 2] : latest;
  if (!latest?.close) {
    return null;
  }

  return createRow({
    definition,
    price: latest.close,
    previousClose: previous?.close ?? null,
    high: latest.high ?? null,
    low: latest.low ?? null,
    provider: "stooq",
    freshAt: Date.now(),
  });
}

async function fetchYahooRow(definition: IndexDefinition): Promise<IndexPriceRow | null> {
  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ] as const;

  for (const host of hosts) {
    try {
      const response = await fetch(
        `${host}/v8/finance/chart/${encodeURIComponent(definition.symbol)}?interval=1d&range=5d&includePrePost=false`,
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
              previousClose?: number;
            };
            indicators?: {
              quote?: Array<{
                high?: Array<number | null>;
                low?: Array<number | null>;
                close?: Array<number | null>;
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
        high: highs[highs.length - 1] ?? null,
        low: lows[lows.length - 1] ?? null,
        provider: "yahoo",
        freshAt: Date.now(),
      });
    } catch {
      continue;
    }
  }

  return null;
}

async function buildRow(definition: IndexDefinition, cachedRow?: IndexPriceRow): Promise<IndexPriceRow> {
  const stooqRow = await fetchStooqRow(definition).catch(() => null);
  if (stooqRow) {
    return stooqRow;
  }

  console.log(`[APEX PRICES] ${definition.symbol}: Stooq failed, trying Yahoo...`);

  const yahooRow = await fetchYahooRow(definition).catch(() => null);
  if (yahooRow) {
    console.log(`[APEX PRICES] ${definition.symbol}: Yahoo succeeded`);
    return yahooRow;
  }

  if (cachedRow) {
    return {
      ...cachedRow,
      stale: true,
      reason: null,
      freshAt: cachedRow.freshAt,
      marketStatus: getMarketStatus(definition),
    };
  }

  return createRow({
    definition,
    price: null,
    previousClose: null,
    high: null,
    low: null,
    provider: "cache",
    stale: true,
    reason: "All index providers unavailable",
    freshAt: Date.now(),
  });
}

export async function GET() {
  const cached = await getCachedJson<IndexPricesPayload>(CACHE_KEY);
  const cachedMap = new Map((cached?.assets ?? []).map(asset => [asset.symbol, asset]));
  const assets = await Promise.all(INDICES.map(definition => buildRow(definition, cachedMap.get(definition.symbol))));
  const payload: IndexPricesPayload = {
    generatedAt: Date.now(),
    assets,
  };

  await setCachedJson(CACHE_KEY, payload, CACHE_TTL_SECONDS);
  return NextResponse.json(payload);
}
