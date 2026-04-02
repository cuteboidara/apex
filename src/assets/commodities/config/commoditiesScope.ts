export const COMMODITIES_SYMBOLS = {
  PRECIOUS_METALS: ["XAUUSD", "XAGUSD"],
  ENERGY: ["WTICOUSD", "BCOUSD", "NATGASUSD"],
} as const;

export type CommodityCategory = keyof typeof COMMODITIES_SYMBOLS;
export type CommoditySymbol = (typeof COMMODITIES_SYMBOLS)[keyof typeof COMMODITIES_SYMBOLS][number];

export const ALL_COMMODITY_SYMBOLS = [
  ...COMMODITIES_SYMBOLS.PRECIOUS_METALS,
  ...COMMODITIES_SYMBOLS.ENERGY,
] as CommoditySymbol[];

export const COMMODITY_DISPLAY_NAMES: Record<CommoditySymbol, string> = {
  XAUUSD: "XAUUSD",
  XAGUSD: "Silver",
  WTICOUSD: "WTI Oil",
  BCOUSD: "Brent Oil",
  NATGASUSD: "Natural Gas",
};

export const COMMODITY_POLYGON_TICKERS: Record<CommoditySymbol, string> = {
  XAUUSD: "C:XAUUSD",
  XAGUSD: "C:XAGUSD",
  WTICOUSD: "C:WTICOUSD",
  BCOUSD: "C:BCOUSD",
  NATGASUSD: "C:NATGASUSD",
};

export const COMMODITY_PROFILES: Record<CommoditySymbol, { minConfidence: number; minRR: number; cooldownMinutes: number }> = {
  XAUUSD: { minConfidence: 0.62, minRR: 1.8, cooldownMinutes: 90 },
  XAGUSD: { minConfidence: 0.62, minRR: 1.8, cooldownMinutes: 90 },
  WTICOUSD: { minConfidence: 0.63, minRR: 1.9, cooldownMinutes: 120 },
  BCOUSD: { minConfidence: 0.63, minRR: 1.9, cooldownMinutes: 120 },
  NATGASUSD: { minConfidence: 0.65, minRR: 2, cooldownMinutes: 150 },
};

export function getCommodityCategory(symbol: CommoditySymbol): CommodityCategory {
  return (COMMODITIES_SYMBOLS.PRECIOUS_METALS as readonly string[]).includes(symbol)
    ? "PRECIOUS_METALS"
    : "ENERGY";
}
