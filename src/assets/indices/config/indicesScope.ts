export const INDICES_SYMBOLS = ["SPX", "NDX", "DJI", "UKX", "DAX", "NKY"] as const;
export type IndexSymbol = typeof INDICES_SYMBOLS[number];

export const INDEX_DISPLAY_NAMES: Record<IndexSymbol, string> = {
  SPX: "S&P 500",
  NDX: "NASDAQ 100",
  DJI: "Dow Jones",
  UKX: "FTSE 100",
  DAX: "DAX",
  NKY: "Nikkei 225",
};

export const INDEX_POLYGON_TICKERS: Record<IndexSymbol, string> = {
  SPX: "I:SPX",
  NDX: "I:NDX",
  DJI: "I:DJI",
  UKX: "I:UKX",
  DAX: "I:DAX",
  NKY: "I:NKY",
};

export const INDEX_MARKET_HOURS: Record<IndexSymbol, { open: number; close: number }> = {
  SPX: { open: 14, close: 21 },
  NDX: { open: 14, close: 21 },
  DJI: { open: 14, close: 21 },
  UKX: { open: 8, close: 16 },
  DAX: { open: 7, close: 15 },
  NKY: { open: 0, close: 6 },
};

export const INDEX_PROFILES: Record<IndexSymbol, { minConfidence: number; minRR: number }> = {
  SPX: { minConfidence: 0.62, minRR: 1.8 },
  NDX: { minConfidence: 0.62, minRR: 1.8 },
  DJI: { minConfidence: 0.60, minRR: 1.75 },
  UKX: { minConfidence: 0.60, minRR: 1.75 },
  DAX: { minConfidence: 0.62, minRR: 1.8 },
  NKY: { minConfidence: 0.60, minRR: 1.75 },
};

export function isIndexMarketOpen(symbol: IndexSymbol): boolean {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay();
  if (utcDay === 0 || utcDay === 6) {
    return false;
  }

  const hours = INDEX_MARKET_HOURS[symbol];
  return utcHour >= hours.open && utcHour < hours.close;
}

export type IndexCategory = "US" | "EUROPE" | "ASIA";

export function getIndexCategory(symbol: IndexSymbol): IndexCategory {
  if (symbol === "SPX" || symbol === "NDX" || symbol === "DJI") {
    return "US";
  }
  if (symbol === "UKX" || symbol === "DAX") {
    return "EUROPE";
  }
  return "ASIA";
}
