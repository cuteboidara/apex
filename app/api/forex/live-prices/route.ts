import { NextResponse } from "next/server";

import { getCachedJson, setCachedJson } from "@/src/lib/redis";
import { fetchYahooBars } from "@/src/lib/yahooFinance";
import { fetchYahooPrice } from "@/lib/providers/yahooFinance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ForexProvider = "oanda" | "twelvedata" | "yahoo" | "erapi" | "cache";
type ForexLivePriceRow = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  spread: number | null;
  provider: ForexProvider;
  freshAt: number;
  stale?: boolean;
  reason?: string | null;
};

type ForexLivePricesPayload = {
  generatedAt: number;
  pairs: ForexLivePriceRow[];
};

const CACHE_KEY = "forex:prices:live";
const CACHE_TTL_SECONDS = 10;
const PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "EURJPY",
  "AUDUSD",
  "NZDUSD",
  "USDCHF",
  "USDCAD",
  "XAUUSD",
  "XAGUSD",
] as const;
const OANDA_SYMBOL_MAP: Record<(typeof PAIRS)[number], string> = {
  EURUSD: "EUR_USD",
  GBPUSD: "GBP_USD",
  USDJPY: "USD_JPY",
  EURJPY: "EUR_JPY",
  AUDUSD: "AUD_USD",
  NZDUSD: "NZD_USD",
  USDCHF: "USD_CHF",
  USDCAD: "USD_CAD",
  XAUUSD: "XAU_USD",
  XAGUSD: "XAG_USD",
};
const TWELVE_DATA_SYMBOL_MAP: Record<(typeof PAIRS)[number], string> = {
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  EURJPY: "EUR/JPY",
  AUDUSD: "AUD/USD",
  NZDUSD: "NZD/USD",
  USDCHF: "USD/CHF",
  USDCAD: "USD/CAD",
  XAUUSD: "XAU/USD",
  XAGUSD: "XAG/USD",
};
const YAHOO_DIRECT_SYMBOL_MAP: Partial<Record<(typeof PAIRS)[number], string>> = {
  XAUUSD: "XAUUSD=X",
  XAGUSD: "XAGUSD=X",
};

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

function resolveOandaBaseUrl() {
  const override = process.env.OANDA_API_BASE_URL?.trim();
  if (override) {
    return override.replace(/\/+$/, "");
  }
  return process.env.OANDA_ENV === "live"
    ? "https://api-fxtrade.oanda.com"
    : "https://api-fxpractice.oanda.com";
}

function pipSize(symbol: string): number {
  if (symbol.endsWith("JPY")) return 0.01;
  if (symbol === "XAUUSD" || symbol === "XAGUSD") return 0.01;
  return 0.0001;
}

function estimateSpread(symbol: string, price: number): number {
  const configuredSpreads: Record<string, number> = {
    EURUSD: 0.00008,
    GBPUSD: 0.00010,
    USDJPY: 0.008,
    EURJPY: 0.012,
    AUDUSD: 0.00009,
    NZDUSD: 0.00012,
    USDCHF: 0.00009,
    USDCAD: 0.00010,
    XAUUSD: 0.30,
    XAGUSD: 0.03,
  };

  return configuredSpreads[symbol] ?? Math.max(price * 0.0001, pipSize(symbol));
}

function normalizeBidAsk(input: {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
}): { bid: number | null; ask: number | null } {
  if (input.mid == null || !Number.isFinite(input.mid) || input.mid <= 0) {
    return {
      bid: input.bid,
      ask: input.ask,
    };
  }

  if (
    input.bid != null
    && input.ask != null
    && Number.isFinite(input.bid)
    && Number.isFinite(input.ask)
    && Math.abs(input.ask - input.bid) > 0
  ) {
    return {
      bid: input.bid,
      ask: input.ask,
    };
  }

  const estimated = estimateSpread(input.symbol, input.mid);
  return {
    bid: input.mid - (estimated / 2),
    ask: input.mid + (estimated / 2),
  };
}

function createRow(input: {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  previousClose: number | null;
  provider: ForexProvider;
  reason?: string | null;
  stale?: boolean;
  freshAt?: number;
}): ForexLivePriceRow {
  const normalizedBidAsk = normalizeBidAsk({
    symbol: input.symbol,
    bid: input.bid,
    ask: input.ask,
    mid: input.mid,
  });
  const spreadRaw = normalizedBidAsk.bid != null && normalizedBidAsk.ask != null
    ? Math.abs(normalizedBidAsk.ask - normalizedBidAsk.bid)
    : null;
  const change = input.mid != null && input.previousClose != null ? input.mid - input.previousClose : null;
  const changePct = change != null && input.previousClose != null && input.previousClose !== 0
    ? (change / input.previousClose) * 100
    : null;

  return {
    symbol: input.symbol,
    bid: normalizedBidAsk.bid,
    ask: normalizedBidAsk.ask,
    mid: input.mid,
    change,
    changePct,
    direction: change == null || change === 0 ? "flat" : change > 0 ? "up" : "down",
    spread: spreadRaw == null ? null : spreadRaw / pipSize(input.symbol),
    provider: input.provider,
    freshAt: input.freshAt ?? Date.now(),
    stale: input.stale ?? false,
    reason: input.reason ?? null,
  };
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === "string" && value.length > 0) {
    if (/^\d+(\.\d+)?$/.test(value)) {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? Math.round(numeric * 1000) : null;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function fetchYahooDirectRow(symbol: (typeof PAIRS)[number]): Promise<ForexLivePriceRow | null> {
  const yahooSymbol = YAHOO_DIRECT_SYMBOL_MAP[symbol];
  if (!yahooSymbol) {
    return null;
  }

  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com",
  ] as const;

  for (const host of hosts) {
    try {
      const response = await fetch(
        `${host}/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1d&range=5d&includePrePost=false`,
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

      const closes = (result.indicators?.quote?.[0]?.close ?? [])
        .filter((close): close is number => typeof close === "number" && Number.isFinite(close) && close > 0);
      const price = parseNumber(result.meta?.regularMarketPrice) ?? closes[closes.length - 1] ?? null;
      const previousClose = parseNumber(result.meta?.chartPreviousClose)
        ?? (closes.length >= 2 ? closes[closes.length - 2] : closes[0] ?? null);

      if (price == null) {
        continue;
      }

      return createRow({
        symbol,
        bid: price,
        ask: price,
        mid: price,
        previousClose,
        provider: "yahoo",
        freshAt: Date.now(),
      });
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchOandaPricing() {
  const apiToken = process.env.OANDA_API_TOKEN?.trim();
  const accountId = process.env.OANDA_ACCOUNT_ID?.trim();
  if (!apiToken || !accountId) {
    return null;
  }

  const instruments = PAIRS.map(symbol => OANDA_SYMBOL_MAP[symbol]).join(",");
  const response = await fetch(`${resolveOandaBaseUrl()}/v3/accounts/${accountId}/pricing?instruments=${encodeURIComponent(instruments)}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Accept-Datetime-Format": "UNIX",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`Oanda pricing failed with ${response.status}`);
  }

  return await response.json() as {
    prices?: Array<{
      instrument?: string;
      closeoutBid?: string;
      closeoutAsk?: string;
      time?: string;
    }>;
  };
}

async function fetchOandaPreviousClose(symbol: (typeof PAIRS)[number]) {
  const apiToken = process.env.OANDA_API_TOKEN?.trim();
  if (!apiToken) {
    return null;
  }
  const response = await fetch(`${resolveOandaBaseUrl()}/v3/instruments/${OANDA_SYMBOL_MAP[symbol]}/candles?price=M&granularity=D&count=2`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Accept-Datetime-Format": "UNIX",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    return null;
  }
  const payload = await response.json() as {
    candles?: Array<{
      complete?: boolean;
      mid?: { c?: string };
    }>;
  };
  const candles = (payload.candles ?? []).filter(candle => candle.complete !== false);
  if (candles.length >= 2) {
    return parseNumber(candles[candles.length - 2]?.mid?.c ?? null);
  }
  if (candles.length === 1) {
    return parseNumber(candles[0]?.mid?.c ?? null);
  }
  return null;
}

async function fetchOandaRows(): Promise<Map<string, ForexLivePriceRow>> {
  const pricingPayload = await fetchOandaPricing();
  if (!pricingPayload?.prices?.length) {
    return new Map();
  }

  const prevCloseResults = await Promise.allSettled(PAIRS.map(symbol => fetchOandaPreviousClose(symbol)));
  const previousCloseMap = new Map<string, number | null>();
  for (const [index, result] of prevCloseResults.entries()) {
    previousCloseMap.set(PAIRS[index], result.status === "fulfilled" ? result.value : null);
  }

  const rows = new Map<string, ForexLivePriceRow>();
  for (const price of pricingPayload.prices ?? []) {
    const symbol = PAIRS.find(candidate => OANDA_SYMBOL_MAP[candidate] === price.instrument);
    if (!symbol) {
      continue;
    }
    const bid = parseNumber(price.closeoutBid);
    const ask = parseNumber(price.closeoutAsk);
    const mid = bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask;
    rows.set(symbol, createRow({
      symbol,
      bid,
      ask,
      mid,
      previousClose: previousCloseMap.get(symbol) ?? null,
      provider: "oanda",
      freshAt: parseTimestampMs(price.time) ?? Date.now(),
    }));
  }

  return rows;
}

async function fetchOandaCandleFallbackRow(symbol: (typeof PAIRS)[number]): Promise<ForexLivePriceRow | null> {
  const apiToken = process.env.OANDA_API_TOKEN?.trim();
  if (!apiToken) {
    return null;
  }

  const response = await fetch(`${resolveOandaBaseUrl()}/v3/instruments/${OANDA_SYMBOL_MAP[symbol]}/candles?price=M&granularity=M1&count=2`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Accept-Datetime-Format": "UNIX",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as {
    candles?: Array<{
      complete?: boolean;
      time?: string;
      mid?: { c?: string };
    }>;
  };
  const candles = (payload.candles ?? []).filter(candle => candle.complete !== false);
  const latest = candles[candles.length - 1];
  if (!latest) {
    return null;
  }
  const mid = parseNumber(latest.mid?.c ?? null);
  const previousClose = candles.length >= 2
    ? parseNumber(candles[candles.length - 2]?.mid?.c ?? null)
    : mid;
  if (mid == null) {
    return null;
  }

  return createRow({
    symbol,
    bid: mid,
    ask: mid,
    mid,
    previousClose,
    provider: "oanda",
    freshAt: parseTimestampMs(latest.time) ?? Date.now(),
  });
}

async function fetchTwelveDataRows(): Promise<Map<string, ForexLivePriceRow>> {
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!apiKey) {
    return new Map();
  }

  const url = new URL("https://api.twelvedata.com/price");
  url.searchParams.set("symbol", PAIRS.map(symbol => TWELVE_DATA_SYMBOL_MAP[symbol]).join(","));
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Twelve Data price failed with ${response.status}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const globalError = typeof payload.message === "string" ? payload.message : null;
  const rows = new Map<string, ForexLivePriceRow>();

  for (const symbol of PAIRS) {
    const providerSymbol = TWELVE_DATA_SYMBOL_MAP[symbol];
    const record = payload[providerSymbol];
    const mid = parseNumber(
      typeof record === "object" && record !== null && !Array.isArray(record)
        ? (record as Record<string, unknown>).price
        : record,
    );
    rows.set(symbol, createRow({
      symbol,
      bid: mid,
      ask: mid,
      mid,
      previousClose: null,
      provider: "twelvedata",
      freshAt: Date.now(),
      stale: mid == null,
      reason: mid == null ? globalError ?? "Twelve Data returned no live price" : null,
    }));
  }

  return rows;
}

async function fetchYahooRow(symbol: (typeof PAIRS)[number]): Promise<ForexLivePriceRow> {
  const directRow = await fetchYahooDirectRow(symbol);
  if (directRow?.mid != null) {
    return directRow;
  }

  const payload = await fetchYahooPrice(symbol);
  let price = parseNumber(payload.price);
  let closes = payload.closes.filter(close => Number.isFinite(close) && close > 0);

  if (price == null) {
    const bars = await fetchYahooBars(symbol, "1D");
    const barCloses = bars?.values
      .map(bar => bar.close)
      .filter((close): close is number => Number.isFinite(close) && close > 0) ?? [];
    if (barCloses.length > 0) {
      price = barCloses[barCloses.length - 1] ?? null;
      closes = barCloses;
    }
  }

  const previousClose = closes.length >= 2
    ? closes[closes.length - 2]
    : closes.length === 1
      ? closes[0]
      : null;
  const row = createRow({
    symbol,
    bid: price,
    ask: price,
    mid: price,
    previousClose,
    provider: "yahoo",
    freshAt: Date.now(),
    stale: price == null,
    reason: price == null ? "Yahoo Finance returned no live price" : null,
  });

  return {
    ...row,
    changePct: payload.change24h ?? row.changePct,
  };
}

type ExchangeRateApiResponse = {
  rates?: Record<string, number>;
};

function parsePair(symbol: (typeof PAIRS)[number]): { base: string; quote: string } {
  return {
    base: symbol.slice(0, 3),
    quote: symbol.slice(3),
  };
}

function computeErApiPrice(symbol: (typeof PAIRS)[number], rates: Record<string, number>): number | null {
  const { base, quote } = parsePair(symbol);
  const usdToBase = base === "USD" ? 1 : parseNumber(rates[base]);
  const usdToQuote = quote === "USD" ? 1 : parseNumber(rates[quote]);
  if (usdToBase == null || usdToQuote == null || usdToBase === 0) {
    return null;
  }
  return usdToQuote / usdToBase;
}

async function fetchExchangeRateApiRows(symbols: readonly (typeof PAIRS)[number][]): Promise<Map<string, ForexLivePriceRow>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const response = await fetch("https://open.er-api.com/v6/latest/USD", {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`open.er-api.com failed with ${response.status}`);
  }

  const payload = await response.json() as ExchangeRateApiResponse;
  const rates = payload.rates ?? {};
  const rows = new Map<string, ForexLivePriceRow>();

  for (const symbol of symbols) {
    const mid = computeErApiPrice(symbol, rates);
    if (mid == null) {
      continue;
    }
    rows.set(symbol, createRow({
      symbol,
      bid: mid,
      ask: mid,
      mid,
      previousClose: null,
      provider: "erapi" as ForexProvider,
      freshAt: Date.now(),
    }));
  }

  return rows;
}

async function buildPayload(cached?: ForexLivePricesPayload | null): Promise<ForexLivePricesPayload> {
  const cachedMap = new Map((cached?.pairs ?? []).map(pair => [pair.symbol, pair]));
  const oandaRows = await fetchOandaRows().catch(error => {
    console.warn("[forex-live-prices] Oanda live pricing failed, falling back to Twelve Data:", error);
    return new Map<string, ForexLivePriceRow>();
  });
  const oandaCandleRows = new Map<string, ForexLivePriceRow>();
  const oandaMissingSymbols = PAIRS.filter(symbol => oandaRows.get(symbol)?.mid == null);
  if (oandaMissingSymbols.length > 0) {
    const oandaCandleResults = await Promise.allSettled(oandaMissingSymbols.map(symbol => fetchOandaCandleFallbackRow(symbol)));
    for (const [index, result] of oandaCandleResults.entries()) {
      const symbol = oandaMissingSymbols[index];
      if (result.status === "fulfilled" && result.value?.mid != null) {
        oandaCandleRows.set(symbol, result.value);
      }
    }
  }
  const twelveDataRows = await fetchTwelveDataRows().catch(error => {
    console.warn("[forex-live-prices] Twelve Data live pricing failed:", error);
    return new Map<string, ForexLivePriceRow>();
  });
  const yahooFallbackSymbols = PAIRS.filter(symbol => {
    const oandaRow = oandaRows.get(symbol);
    const oandaCandleRow = oandaCandleRows.get(symbol);
    const twelveDataRow = twelveDataRows.get(symbol);
    return oandaRow?.mid == null && oandaCandleRow?.mid == null && twelveDataRow?.mid == null;
  });
  const yahooResultMap = new Map<string, ForexLivePriceRow>();
  if (yahooFallbackSymbols.length > 0) {
    const yahooResults = await Promise.allSettled(yahooFallbackSymbols.map(symbol => fetchYahooRow(symbol)));
    for (const [index, result] of yahooResults.entries()) {
      const symbol = yahooFallbackSymbols[index];
      yahooResultMap.set(
        symbol,
        result.status === "fulfilled"
          ? result.value
          : createRow({
              symbol,
              bid: null,
              ask: null,
              mid: null,
              previousClose: null,
              provider: "yahoo",
              stale: true,
              reason: result.status === "rejected" && result.reason instanceof Error
                ? result.reason.message
                : "Yahoo Finance live quote unavailable",
              freshAt: Date.now(),
            }),
      );
    }
  }
  const exchangeRateSymbols = PAIRS.filter(symbol => {
    const oandaRow = oandaRows.get(symbol);
    const oandaCandleRow = oandaCandleRows.get(symbol);
    const twelveDataRow = twelveDataRows.get(symbol);
    const yahooRow = yahooResultMap.get(symbol);
    return oandaRow?.mid == null && oandaCandleRow?.mid == null && twelveDataRow?.mid == null && yahooRow?.mid == null;
  });
  const exchangeRateRows = await fetchExchangeRateApiRows(exchangeRateSymbols).catch(error => {
    console.warn("[forex-live-prices] open.er-api.com live pricing failed:", error);
    return new Map<string, ForexLivePriceRow>();
  });

  const pairs: ForexLivePriceRow[] = [];
  for (const symbol of PAIRS) {
    const oandaRow = oandaRows.get(symbol);
    if (oandaRow?.mid != null) {
      pairs.push(oandaRow);
      continue;
    }

    const oandaCandleRow = oandaCandleRows.get(symbol);
    if (oandaCandleRow?.mid != null) {
      pairs.push(oandaCandleRow);
      continue;
    }

    const twelveDataRow = twelveDataRows.get(symbol);
    if (twelveDataRow?.mid != null) {
      pairs.push(twelveDataRow);
      continue;
    }

    const yahooRow = yahooResultMap.get(symbol);
    if (yahooRow?.mid != null) {
      pairs.push(yahooRow);
      continue;
    }

    const exchangeRateRow = exchangeRateRows.get(symbol);
    if (exchangeRateRow?.mid != null) {
      pairs.push(exchangeRateRow);
      continue;
    }

    const cachedRow = cachedMap.get(symbol);
    if (cachedRow?.mid != null) {
      pairs.push({
        ...cachedRow,
        stale: true,
        reason: null,
      });
      continue;
    }

    pairs.push(
      createRow({
        symbol,
        bid: null,
        ask: null,
        mid: null,
        previousClose: null,
        provider: "yahoo",
        stale: true,
        reason: "Live quote unavailable",
        freshAt: Date.now(),
      }),
    );
  }

  return {
    generatedAt: Date.now(),
    pairs,
  };
}

export async function GET() {
  const cached = await getCachedJson<ForexLivePricesPayload>(CACHE_KEY);
  const payload = await buildPayload(cached);
  await setCachedJson(CACHE_KEY, payload, CACHE_TTL_SECONDS);
  return NextResponse.json(payload);
}
