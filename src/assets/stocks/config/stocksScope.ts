export const STOCKS_SYMBOLS = {
  US_LARGE_CAP: [
    "AAPL", "MSFT", "GOOGL", "AMZN", "META",
    "NVDA", "TSLA", "BRK.B", "JPM", "JNJ",
    "V", "PG", "HD", "MA", "BAC",
    "NFLX", "PYPL", "ADBE", "CRM", "AMD",
  ],
  US_TECH: [
    "ORCL", "INTC", "QCOM", "MU", "SNOW",
    "PLTR", "UBER", "ABNB", "SHOP", "COIN",
  ],
  FTSE_UK: [
    "HSBA.L", "BP.L", "SHEL.L", "AZN.L", "ULVR.L",
    "RIO.L", "GSK.L", "DGE.L", "VOD.L", "LLOY.L",
  ],
  GLOBAL: [
    "TSM", "BABA", "NVO", "ASML", "SAP",
    "TM", "SONY", "MELI", "SE", "BIDU",
  ],
} as const;

export type StockCategory = keyof typeof STOCKS_SYMBOLS;
export type StockSymbol = (typeof STOCKS_SYMBOLS)[keyof typeof STOCKS_SYMBOLS][number];

export const ALL_STOCK_SYMBOLS = [
  ...STOCKS_SYMBOLS.US_LARGE_CAP,
  ...STOCKS_SYMBOLS.US_TECH,
  ...STOCKS_SYMBOLS.FTSE_UK,
  ...STOCKS_SYMBOLS.GLOBAL,
] as StockSymbol[];

export const STOCK_DISPLAY_NAMES = Object.fromEntries(
  ALL_STOCK_SYMBOLS.map(symbol => [symbol, symbol]),
) as Record<StockSymbol, string>;

export interface StockProfile {
  symbol: StockSymbol;
  category: StockCategory;
  displayName: string;
  marketOpen: number;
  marketClose: number;
  marketDays: number[];
  minConfidence: number;
  minRR: number;
  maxSignalsPerDay: number;
  cooldownMinutes: number;
  earningsMultiplier: number;
}

export const DEFAULT_STOCK_PROFILE = {
  marketDays: [1, 2, 3, 4, 5],
  minConfidence: 0.60,
  minRR: 1.8,
  maxSignalsPerDay: 2,
  cooldownMinutes: 90,
  earningsMultiplier: 1.3,
} as const;

export const MARKET_HOURS = {
  US_LARGE_CAP: { open: 14, close: 21 },
  US_TECH: { open: 14, close: 21 },
  FTSE_UK: { open: 8, close: 16 },
  GLOBAL: { open: 8, close: 21 },
} as const satisfies Record<StockCategory, { open: number; close: number }>;

export function isStockMarketOpen(category: StockCategory): boolean {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay();
  if (utcDay === 0 || utcDay === 6) {
    return false;
  }

  const hours = MARKET_HOURS[category];
  return utcHour >= hours.open && utcHour < hours.close;
}

export function getStockCategory(symbol: string): StockCategory {
  for (const [category, symbols] of Object.entries(STOCKS_SYMBOLS)) {
    if ((symbols as readonly string[]).includes(symbol)) {
      return category as StockCategory;
    }
  }
  return "US_LARGE_CAP";
}
