import type { AssetClass } from "@/lib/marketData/types";

export type TradingViewSymbolType = "crypto" | "forex" | "commodity";

export type TradingViewSymbolDefinition = {
  symbol: "BTCUSDT" | "ETHUSDT" | "EURUSD" | "GBPUSD" | "USDJPY" | "XAUUSD" | "XAGUSD";
  description: string;
  assetClass: AssetClass;
  type: TradingViewSymbolType;
  session: "24x7" | "24x5";
  timezone: "Etc/UTC";
  exchange: "APEX";
  minmov: 1;
  pricescale: number;
};

export type TradingViewSymbolSearchResult = {
  symbol: string;
  full_name: string;
  description: string;
  exchange: string;
  ticker: string;
  type: TradingViewSymbolType;
};

const SYMBOL_DEFINITIONS: readonly TradingViewSymbolDefinition[] = [
  {
    symbol: "BTCUSDT",
    description: "Bitcoin / Tether",
    assetClass: "CRYPTO",
    type: "crypto",
    session: "24x7",
    timezone: "Etc/UTC",
    exchange: "APEX",
    minmov: 1,
    pricescale: 100,
  },
  {
    symbol: "ETHUSDT",
    description: "Ether / Tether",
    assetClass: "CRYPTO",
    type: "crypto",
    session: "24x7",
    timezone: "Etc/UTC",
    exchange: "APEX",
    minmov: 1,
    pricescale: 100,
  },
  {
    symbol: "EURUSD",
    description: "Euro / US Dollar",
    assetClass: "FOREX",
    type: "forex",
    session: "24x5",
    timezone: "Etc/UTC",
    exchange: "APEX",
    minmov: 1,
    pricescale: 100000,
  },
  {
    symbol: "GBPUSD",
    description: "Pound Sterling / US Dollar",
    assetClass: "FOREX",
    type: "forex",
    session: "24x5",
    timezone: "Etc/UTC",
    exchange: "APEX",
    minmov: 1,
    pricescale: 100000,
  },
  {
    symbol: "USDJPY",
    description: "US Dollar / Japanese Yen",
    assetClass: "FOREX",
    type: "forex",
    session: "24x5",
    timezone: "Etc/UTC",
    exchange: "APEX",
    minmov: 1,
    pricescale: 1000,
  },
  {
    symbol: "XAUUSD",
    description: "Gold / US Dollar",
    assetClass: "COMMODITY",
    type: "commodity",
    session: "24x5",
    timezone: "Etc/UTC",
    exchange: "APEX",
    minmov: 1,
    pricescale: 100,
  },
  {
    symbol: "XAGUSD",
    description: "Silver / US Dollar",
    assetClass: "COMMODITY",
    type: "commodity",
    session: "24x5",
    timezone: "Etc/UTC",
    exchange: "APEX",
    minmov: 1,
    pricescale: 1000,
  },
] as const;

function normalizeSymbolQuery(value: string) {
  return value.trim().toUpperCase().replace(/^APEX:/, "");
}

export function listTradingViewSymbols() {
  return [...SYMBOL_DEFINITIONS];
}

export function getTradingViewSymbol(symbol: string): TradingViewSymbolDefinition | null {
  const normalized = normalizeSymbolQuery(symbol);
  return SYMBOL_DEFINITIONS.find(candidate => candidate.symbol === normalized) ?? null;
}

export function toTradingViewSearchResult(symbol: TradingViewSymbolDefinition): TradingViewSymbolSearchResult {
  return {
    symbol: symbol.symbol,
    full_name: `${symbol.exchange}:${symbol.symbol}`,
    description: symbol.description,
    exchange: symbol.exchange,
    ticker: symbol.symbol,
    type: symbol.type,
  };
}

export function searchTradingViewSymbols(
  query: string,
  exchange?: string | null,
  symbolType?: string | null
) {
  const normalizedQuery = normalizeSymbolQuery(query);
  const normalizedExchange = exchange?.trim().toUpperCase() ?? "";
  const normalizedType = symbolType?.trim().toLowerCase() ?? "";

  return SYMBOL_DEFINITIONS
    .filter(candidate => {
      if (normalizedExchange && normalizedExchange !== candidate.exchange) {
        return false;
      }

      if (normalizedType && normalizedType !== candidate.type) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        candidate.symbol,
        `${candidate.exchange}:${candidate.symbol}`,
        candidate.description,
      ].join(" ").toUpperCase();

      return haystack.includes(normalizedQuery);
    })
    .map(toTradingViewSearchResult);
}
