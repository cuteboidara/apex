import { fetchYahooBars } from "@/src/lib/yahooFinance";
import { fetchYahooPrice } from "@/lib/providers/yahooFinance";

export type TraderLivePriceMap = Record<string, number | null>;

const SYMBOL_TO_TWELVE_DATA: Record<string, string> = {
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

const OANDA_SYMBOL_MAP: Record<string, string> = {
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

const YAHOO_DIRECT_SYMBOL_MAP: Record<string, string> = {
  XAUUSD: "XAUUSD=X",
  XAGUSD: "XAGUSD=X",
};

const TWELVE_DATA_PRICE_URL = "https://api.twelvedata.com/price";
const CACHE_TTL_MS = 15_000;

type ExchangeRateApiResponse = {
  rates?: Record<string, number>;
};

let priceCache: { data: TraderLivePriceMap; fetchedAt: number } | null = null;
let hasWarnedAboutMissingApiKey = false;

function normalizeLivePrice(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (Math.abs(value) >= 1000) {
    return Number(value.toFixed(2));
  }

  if (Math.abs(value) >= 1) {
    return Number(value.toFixed(4));
  }

  return Number(value.toFixed(6));
}

function nullPriceMap(symbols: readonly string[]): TraderLivePriceMap {
  return Object.fromEntries(symbols.map(symbol => [symbol, null] as const));
}

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

function parsePriceRecord(value: unknown): number | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return normalizeLivePrice(Number(value));
  }

  if (typeof value === "object") {
    const price = (value as { price?: unknown }).price;
    return price == null ? null : normalizeLivePrice(Number(price));
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

async function fetchOandaRows(symbols: readonly string[]): Promise<TraderLivePriceMap> {
  const apiToken = process.env.OANDA_API_TOKEN?.trim();
  const accountId = process.env.OANDA_ACCOUNT_ID?.trim();
  const supportedSymbols = symbols.filter(symbol => OANDA_SYMBOL_MAP[symbol]);
  if (!apiToken || !accountId || supportedSymbols.length === 0) {
    return {};
  }

  const instruments = supportedSymbols.map(symbol => OANDA_SYMBOL_MAP[symbol]).join(",");
  const response = await fetch(
    `${resolveOandaBaseUrl()}/v3/accounts/${accountId}/pricing?instruments=${encodeURIComponent(instruments)}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Accept-Datetime-Format": "UNIX",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    },
  );

  if (!response.ok) {
    throw new Error(`Oanda pricing failed with ${response.status}`);
  }

  const payload = await response.json() as {
    prices?: Array<{
      instrument?: string;
      closeoutBid?: string;
      closeoutAsk?: string;
      time?: string;
    }>;
  };

  const next: TraderLivePriceMap = {};
  for (const row of payload.prices ?? []) {
    const symbol = supportedSymbols.find(candidate => OANDA_SYMBOL_MAP[candidate] === row.instrument);
    if (!symbol) {
      continue;
    }
    const bid = parseNumber(row.closeoutBid);
    const ask = parseNumber(row.closeoutAsk);
    const mid = bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask;
    if (mid != null) {
      next[symbol] = normalizeLivePrice(mid);
    }
  }

  return next;
}

async function fetchOandaCandleFallback(symbol: string): Promise<number | null> {
  const apiToken = process.env.OANDA_API_TOKEN?.trim();
  const instrument = OANDA_SYMBOL_MAP[symbol];
  if (!apiToken || !instrument) {
    return null;
  }

  const response = await fetch(
    `${resolveOandaBaseUrl()}/v3/instruments/${instrument}/candles?price=M&granularity=M1&count=1`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Accept-Datetime-Format": "UNIX",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    },
  );
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
  const latest = (payload.candles ?? []).find(candle => candle.complete !== false);
  return normalizeLivePrice(parseNumber(latest?.mid?.c ?? null));
}

async function fetchTwelveDataRows(symbols: readonly string[]): Promise<TraderLivePriceMap> {
  const apiKey = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!apiKey) {
    if (!hasWarnedAboutMissingApiKey) {
      hasWarnedAboutMissingApiKey = true;
      console.warn("[livePrices] TWELVE_DATA_API_KEY not set — skipping Twelve Data fallback");
    }
    return {};
  }

  const supportedSymbols = symbols.filter(symbol => SYMBOL_TO_TWELVE_DATA[symbol]);
  if (supportedSymbols.length === 0) {
    return {};
  }

  const twelveSymbols = supportedSymbols.map(symbol => SYMBOL_TO_TWELVE_DATA[symbol]).join(",");
  const url = new URL(TWELVE_DATA_PRICE_URL);
  url.searchParams.set("symbol", twelveSymbols);
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url.toString(), {
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  const next: TraderLivePriceMap = {};

  for (const symbol of supportedSymbols) {
    const providerSymbol = SYMBOL_TO_TWELVE_DATA[symbol];
    const row = payload[providerSymbol];
    const parsed = parsePriceRecord(row);
    if (parsed != null) {
      next[symbol] = parsed;
    }
  }

  return next;
}

async function fetchYahooDirectPrice(symbol: string): Promise<number | null> {
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
          signal: AbortSignal.timeout(4_000),
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
      const closes = (result?.indicators?.quote?.[0]?.close ?? [])
        .filter((close): close is number => typeof close === "number" && Number.isFinite(close) && close > 0);
      const price = parseNumber(result?.meta?.regularMarketPrice) ?? closes[closes.length - 1] ?? null;
      if (price != null) {
        return normalizeLivePrice(price);
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function fetchYahooRow(symbol: string): Promise<number | null> {
  const direct = await fetchYahooDirectPrice(symbol);
  if (direct != null) {
    return direct;
  }

  try {
    const payload = await fetchYahooPrice(symbol);
    if (payload.price != null && Number.isFinite(payload.price) && payload.price > 0) {
      return normalizeLivePrice(payload.price);
    }
  } catch {
    // Fall through to bars.
  }

  try {
    const bars = await fetchYahooBars(symbol, "1D");
    const close = bars?.values
      .map(bar => bar.close)
      .filter((value): value is number => Number.isFinite(value) && value > 0)
      .at(-1) ?? null;
    return normalizeLivePrice(close);
  } catch {
    return null;
  }
}

function parsePair(symbol: string): { base: string; quote: string } {
  return {
    base: symbol.slice(0, 3),
    quote: symbol.slice(3),
  };
}

function computeErApiPrice(symbol: string, rates: Record<string, number>): number | null {
  const { base, quote } = parsePair(symbol);
  const usdToBase = base === "USD" ? 1 : parseNumber(rates[base]);
  const usdToQuote = quote === "USD" ? 1 : parseNumber(rates[quote]);
  if (usdToBase == null || usdToQuote == null || usdToBase === 0) {
    return null;
  }
  return normalizeLivePrice(usdToQuote / usdToBase);
}

async function fetchExchangeRateApiRows(symbols: readonly string[]): Promise<TraderLivePriceMap> {
  const supportedSymbols = symbols.filter(symbol =>
    symbol.length === 6
    && !symbol.startsWith("XAU")
    && !symbol.startsWith("XAG")
    && symbol in SYMBOL_TO_TWELVE_DATA,
  );
  if (supportedSymbols.length === 0) {
    return {};
  }

  const response = await fetch("https://open.er-api.com/v6/latest/USD", {
    cache: "no-store",
    signal: AbortSignal.timeout(4_000),
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`open.er-api.com failed with ${response.status}`);
  }

  const payload = await response.json() as ExchangeRateApiResponse;
  const rates = payload.rates ?? {};
  const next: TraderLivePriceMap = {};
  for (const symbol of supportedSymbols) {
    const price = computeErApiPrice(symbol, rates);
    if (price != null) {
      next[symbol] = price;
    }
  }
  return next;
}

function extractCached(symbols: readonly string[]): TraderLivePriceMap {
  return {
    ...nullPriceMap(symbols),
    ...Object.fromEntries(symbols.map(symbol => [symbol, priceCache?.data[symbol] ?? null] as const)),
  };
}

export async function fetchLivePrices(symbols: readonly string[]): Promise<TraderLivePriceMap> {
  const now = Date.now();
  if (priceCache && now - priceCache.fetchedAt < CACHE_TTL_MS) {
    return extractCached(symbols);
  }

  const next: TraderLivePriceMap = extractCached(symbols);

  try {
    const oandaRows = await fetchOandaRows(symbols);
    Object.assign(next, oandaRows);
  } catch (error) {
    console.warn("[livePrices] Oanda live pricing failed:", error instanceof Error ? error.message : String(error));
  }

  const unresolvedAfterOanda = symbols.filter(symbol => next[symbol] == null);
  if (unresolvedAfterOanda.length > 0) {
    const candleResults = await Promise.allSettled(unresolvedAfterOanda.map(symbol => fetchOandaCandleFallback(symbol)));
    for (const [index, result] of candleResults.entries()) {
      if (result.status === "fulfilled" && result.value != null) {
        next[unresolvedAfterOanda[index]] = result.value;
      }
    }
  }

  const unresolvedAfterCandle = symbols.filter(symbol => next[symbol] == null);
  if (unresolvedAfterCandle.length > 0) {
    try {
      const twelveRows = await fetchTwelveDataRows(unresolvedAfterCandle);
      Object.assign(next, twelveRows);
    } catch (error) {
      console.warn("[livePrices] Twelve Data fetch failed:", error instanceof Error ? error.message : String(error));
    }
  }

  const unresolvedAfterTwelve = symbols.filter(symbol => next[symbol] == null);
  if (unresolvedAfterTwelve.length > 0) {
    const yahooResults = await Promise.allSettled(unresolvedAfterTwelve.map(symbol => fetchYahooRow(symbol)));
    for (const [index, result] of yahooResults.entries()) {
      if (result.status === "fulfilled" && result.value != null) {
        next[unresolvedAfterTwelve[index]] = result.value;
      }
    }
  }

  const unresolvedAfterYahoo = symbols.filter(symbol => next[symbol] == null);
  if (unresolvedAfterYahoo.length > 0) {
    try {
      const erApiRows = await fetchExchangeRateApiRows(unresolvedAfterYahoo);
      Object.assign(next, erApiRows);
    } catch (error) {
      console.warn("[livePrices] open.er-api.com fetch failed:", error instanceof Error ? error.message : String(error));
    }
  }

  priceCache = {
    data: next,
    fetchedAt: now,
  };

  return extractCached(symbols);
}
