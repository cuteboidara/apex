import {
  getCoinGeckoIdForSymbol,
  getCryptoShortSymbol,
} from "@/src/crypto/config/cryptoScope";

const REQUEST_TIMEOUT_MS = 8_000;
const BINANCE_REST_BASE = "https://api.binance.com/api/v3";
const BYBIT_REST_BASE = "https://api.bybit.com/v5/market";
const COINGECKO_REST_BASE = "https://api.coingecko.com/api/v3";
const CRYPTOCOMPARE_REST_BASE = "https://min-api.cryptocompare.com/data";

export type CryptoMarketProvider = "binance" | "bybit" | "coingecko" | "cryptocompare";
export type CryptoMarketSource = "binance_24hr" | "bybit_tickers" | "cryptocompare_quotes" | "coingecko_markets";

export type CryptoMarketQuote = {
  symbol: string;
  lastPrice: number | null;
  change24h: number | null;
  priceChangePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  quoteVolume24h: number | null;
  marketCap: number | null;
  provider: CryptoMarketProvider;
  source: CryptoMarketSource;
};

export type CryptoMarketUniverseSnapshot = {
  provider: CryptoMarketSource;
  providerPath: CryptoMarketSource[];
  providerErrors: string[];
  rows: CryptoMarketQuote[];
};

export type CryptoMarketQuoteSnapshot = {
  providerPath: CryptoMarketSource[];
  providerErrors: string[];
  rows: Map<string, CryptoMarketQuote>;
};

type BinanceTicker24hr = {
  symbol?: string;
  lastPrice?: string;
  priceChange?: string;
  priceChangePercent?: string;
  highPrice?: string;
  lowPrice?: string;
  quoteVolume?: string;
};

type BybitTicker = {
  symbol?: string;
  lastPrice?: string;
  price24hPcnt?: string;
  highPrice24h?: string;
  lowPrice24h?: string;
  turnover24h?: string;
};

type CoinGeckoMarketCoin = {
  symbol?: string;
  current_price?: number;
  total_volume?: number;
  market_cap?: number;
  high_24h?: number;
  low_24h?: number;
  price_change_24h?: number;
  price_change_percentage_24h?: number;
};

type CryptoCompareUsdQuote = {
  PRICE?: number;
  CHANGE24HOUR?: number;
  CHANGEPCT24HOUR?: number;
  HIGH24HOUR?: number;
  LOW24HOUR?: number;
  TOTALVOLUME24HTO?: number;
  TOTALVOLUME24H?: number;
  MKTCAP?: number;
};

function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
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

function buildTimeoutController(timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    controller,
    clear: () => clearTimeout(timeout),
  };
}

async function fetchJsonWithTimeout<T>(input: string): Promise<T> {
  const { controller, clear } = buildTimeoutController();
  try {
    const response = await fetch(input, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`http_${response.status}`);
    }

    return await response.json() as T;
  } finally {
    clear();
  }
}

function sortUniverseRows(rows: CryptoMarketQuote[]): CryptoMarketQuote[] {
  return [...rows].sort((left, right) => (right.quoteVolume24h ?? 0) - (left.quoteVolume24h ?? 0));
}

function mapBinanceTickerRow(item: BinanceTicker24hr): CryptoMarketQuote | null {
  const symbol = normalizeSymbol(item.symbol ?? "");
  if (!symbol.endsWith("USDT")) {
    return null;
  }

  return {
    symbol,
    lastPrice: parseNumber(item.lastPrice),
    change24h: parseNumber(item.priceChange),
    priceChangePct24h: parseNumber(item.priceChangePercent),
    high24h: parseNumber(item.highPrice),
    low24h: parseNumber(item.lowPrice),
    quoteVolume24h: parseNumber(item.quoteVolume),
    marketCap: null,
    provider: "binance",
    source: "binance_24hr",
  };
}

function deriveAbsoluteChange(lastPrice: number | null, priceChangePct24h: number | null): number | null {
  if (lastPrice == null || priceChangePct24h == null) {
    return null;
  }

  const ratio = 1 + (priceChangePct24h / 100);
  if (!Number.isFinite(ratio) || ratio === 0) {
    return null;
  }

  const previous = lastPrice / ratio;
  if (!Number.isFinite(previous)) {
    return null;
  }

  return lastPrice - previous;
}

function mapBybitTickerRow(item: BybitTicker): CryptoMarketQuote | null {
  const symbol = normalizeSymbol(item.symbol ?? "");
  if (!symbol.endsWith("USDT")) {
    return null;
  }

  const lastPrice = parseNumber(item.lastPrice);
  const pct = parseNumber(item.price24hPcnt);
  const priceChangePct24h = pct == null ? null : pct * 100;

  return {
    symbol,
    lastPrice,
    change24h: deriveAbsoluteChange(lastPrice, priceChangePct24h),
    priceChangePct24h,
    high24h: parseNumber(item.highPrice24h),
    low24h: parseNumber(item.lowPrice24h),
    quoteVolume24h: parseNumber(item.turnover24h),
    marketCap: null,
    provider: "bybit",
    source: "bybit_tickers",
  };
}

function mapCoinGeckoRow(item: CoinGeckoMarketCoin): CryptoMarketQuote | null {
  const base = normalizeSymbol(item.symbol ?? "");
  if (!base) {
    return null;
  }

  return {
    symbol: `${base}USDT`,
    lastPrice: parseNumber(item.current_price),
    change24h: parseNumber(item.price_change_24h),
    priceChangePct24h: parseNumber(item.price_change_percentage_24h),
    high24h: parseNumber(item.high_24h),
    low24h: parseNumber(item.low_24h),
    quoteVolume24h: parseNumber(item.total_volume),
    marketCap: parseNumber(item.market_cap),
    provider: "coingecko",
    source: "coingecko_markets",
  };
}

function mapCryptoCompareRow(baseSymbol: string, quote: CryptoCompareUsdQuote | null | undefined): CryptoMarketQuote | null {
  if (!quote) {
    return null;
  }

  const base = normalizeSymbol(baseSymbol);
  if (!base) {
    return null;
  }

  return {
    symbol: `${base}USDT`,
    lastPrice: parseNumber(quote.PRICE),
    change24h: parseNumber(quote.CHANGE24HOUR),
    priceChangePct24h: parseNumber(quote.CHANGEPCT24HOUR),
    high24h: parseNumber(quote.HIGH24HOUR),
    low24h: parseNumber(quote.LOW24HOUR),
    quoteVolume24h: parseNumber(quote.TOTALVOLUME24HTO ?? quote.TOTALVOLUME24H),
    marketCap: parseNumber(quote.MKTCAP),
    provider: "cryptocompare",
    source: "cryptocompare_quotes",
  };
}

async function fetchBinanceUniverseRows(): Promise<CryptoMarketQuote[]> {
  const payload = await fetchJsonWithTimeout<BinanceTicker24hr[]>(`${BINANCE_REST_BASE}/ticker/24hr`);
  return sortUniverseRows(
    payload
      .map(mapBinanceTickerRow)
      .filter((row): row is CryptoMarketQuote => row != null),
  );
}

async function fetchBybitUniverseRows(): Promise<CryptoMarketQuote[]> {
  const payload = await fetchJsonWithTimeout<{
    retCode?: number;
    retMsg?: string;
    result?: {
      list?: BybitTicker[];
    };
  }>(`${BYBIT_REST_BASE}/tickers?category=spot`);

  if (payload.retCode !== 0) {
    throw new Error(payload.retMsg || "bybit_ret_code");
  }

  return sortUniverseRows(
    (payload.result?.list ?? [])
      .map(mapBybitTickerRow)
      .filter((row): row is CryptoMarketQuote => row != null),
  );
}

async function fetchCoinGeckoUniverseRows(): Promise<CryptoMarketQuote[]> {
  const payload = await fetchJsonWithTimeout<CoinGeckoMarketCoin[]>(
    `${COINGECKO_REST_BASE}/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`,
  );

  return sortUniverseRows(
    payload
      .map(mapCoinGeckoRow)
      .filter((row): row is CryptoMarketQuote => row != null),
  );
}

async function fetchCryptoCompareUniverseRows(): Promise<CryptoMarketQuote[]> {
  const payload = await fetchJsonWithTimeout<{
    Data?: Array<{
      CoinInfo?: {
        Name?: string;
      };
      RAW?: {
        USD?: CryptoCompareUsdQuote;
      };
    }>;
  }>(`${CRYPTOCOMPARE_REST_BASE}/top/totalvolfull?limit=100&tsym=USD`);

  return sortUniverseRows(
    (payload.Data ?? [])
      .map(entry => mapCryptoCompareRow(entry.CoinInfo?.Name ?? "", entry.RAW?.USD))
      .filter((row): row is CryptoMarketQuote => row != null),
  );
}

async function fetchBinanceQuotes(symbols: string[]): Promise<Map<string, CryptoMarketQuote>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const url = new URL(`${BINANCE_REST_BASE}/ticker/24hr`);
  url.searchParams.set("symbols", JSON.stringify(symbols));
  const payload = await fetchJsonWithTimeout<BinanceTicker24hr[]>(url.toString());

  return new Map(
    payload
      .map(mapBinanceTickerRow)
      .filter((row): row is CryptoMarketQuote => row != null)
      .filter(row => symbols.includes(row.symbol))
      .map(row => [row.symbol, row]),
  );
}

async function fetchBybitQuotes(symbols: string[]): Promise<Map<string, CryptoMarketQuote>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const rows = await fetchBybitUniverseRows();
  return new Map(
    rows
      .filter(row => symbols.includes(row.symbol))
      .map(row => [row.symbol, row]),
  );
}

async function fetchCoinGeckoQuotes(symbols: string[]): Promise<Map<string, CryptoMarketQuote>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const ids = [...new Set(
    symbols
      .map(symbol => getCoinGeckoIdForSymbol(symbol) ?? getCoinGeckoIdForSymbol(getCryptoShortSymbol(symbol)))
      .filter((value): value is string => typeof value === "string" && value.length > 0),
  )];

  const rows = ids.length > 0
    ? (
      await fetchJsonWithTimeout<CoinGeckoMarketCoin[]>(
        `${COINGECKO_REST_BASE}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(ids.join(","))}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`,
      )
    )
      .map(mapCoinGeckoRow)
      .filter((row): row is CryptoMarketQuote => row != null)
    : await fetchCoinGeckoUniverseRows();

  return new Map(
    rows
      .filter(row => symbols.includes(row.symbol))
      .map(row => [row.symbol, row]),
  );
}

async function fetchCryptoCompareQuotes(symbols: string[]): Promise<Map<string, CryptoMarketQuote>> {
  if (symbols.length === 0) {
    return new Map();
  }

  const bases = [...new Set(symbols.map(symbol => getCryptoShortSymbol(symbol)).filter(Boolean))];
  const payload = await fetchJsonWithTimeout<{
    RAW?: Record<string, {
      USD?: CryptoCompareUsdQuote;
    }>;
  }>(
    `${CRYPTOCOMPARE_REST_BASE}/pricemultifull?fsyms=${encodeURIComponent(bases.join(","))}&tsyms=USD`,
  );

  const rows = bases
    .map(base => mapCryptoCompareRow(base, payload.RAW?.[base]?.USD))
    .filter((row): row is CryptoMarketQuote => row != null)
    .filter(row => symbols.includes(row.symbol));

  return new Map(rows.map(row => [row.symbol, row]));
}

export async function fetchCryptoMarketUniverse(limit = 50): Promise<CryptoMarketUniverseSnapshot> {
  const providerPath: CryptoMarketSource[] = [];
  const providerErrors: string[] = [];
  const providers: Array<{
    source: CryptoMarketSource;
    fetcher: () => Promise<CryptoMarketQuote[]>;
  }> = [
    { source: "binance_24hr", fetcher: fetchBinanceUniverseRows },
    { source: "bybit_tickers", fetcher: fetchBybitUniverseRows },
    { source: "cryptocompare_quotes", fetcher: fetchCryptoCompareUniverseRows },
    { source: "coingecko_markets", fetcher: fetchCoinGeckoUniverseRows },
  ];

  for (const provider of providers) {
    providerPath.push(provider.source);
    try {
      const rows = await provider.fetcher();
      if (rows.length === 0) {
        throw new Error("empty_universe");
      }

      console.log(
        `[crypto-market] universe provider=${provider.source} rows=${rows.length} path=${providerPath.join("->") || "none"}${providerErrors.length > 0 ? ` errors=${providerErrors.join(" | ")}` : ""}`,
      );
      return {
        provider: provider.source,
        providerPath: [...providerPath],
        providerErrors: [...providerErrors],
        rows: rows.slice(0, limit),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      providerErrors.push(`${provider.source}:${message}`);
    }
  }

  throw new Error(`crypto_market_universe_unavailable:${providerErrors.join("|")}`);
}

export async function fetchCryptoSpotQuotes(symbols: string[]): Promise<CryptoMarketQuoteSnapshot> {
  const requestedSymbols = [...new Set(symbols.map(normalizeSymbol).filter(symbol => symbol.endsWith("USDT")))];
  const providerPath: CryptoMarketSource[] = [];
  const providerErrors: string[] = [];
  const rows = new Map<string, CryptoMarketQuote>();

  if (requestedSymbols.length === 0) {
    return {
      providerPath,
      providerErrors,
      rows,
    };
  }

  const quoteProviders: Array<{
    source: CryptoMarketSource;
    fetcher: (requested: string[]) => Promise<Map<string, CryptoMarketQuote>>;
  }> = [
    { source: "binance_24hr", fetcher: fetchBinanceQuotes },
    { source: "bybit_tickers", fetcher: fetchBybitQuotes },
    { source: "cryptocompare_quotes", fetcher: fetchCryptoCompareQuotes },
    { source: "coingecko_markets", fetcher: fetchCoinGeckoQuotes },
  ];

  for (const provider of quoteProviders) {
    const missing = requestedSymbols.filter(symbol => !rows.has(symbol));
    if (missing.length === 0) {
      break;
    }

    providerPath.push(provider.source);
    try {
      const batch = await provider.fetcher(missing);
      for (const [symbol, row] of batch.entries()) {
        rows.set(symbol, row);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      providerErrors.push(`${provider.source}:${message}`);
    }
  }

  console.log(
    `[crypto-market] quotes requested=${requestedSymbols.length} resolved=${rows.size} path=${providerPath.join("->") || "none"}${providerErrors.length > 0 ? ` errors=${providerErrors.join(" | ")}` : ""}`,
  );

  return {
    providerPath,
    providerErrors,
    rows,
  };
}

export async function fetchCryptoSpotQuote(symbol: string): Promise<CryptoMarketQuote | null> {
  const snapshot = await fetchCryptoSpotQuotes([symbol]);
  return snapshot.rows.get(normalizeSymbol(symbol)) ?? null;
}
