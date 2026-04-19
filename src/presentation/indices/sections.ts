export const AMT_SECTIONS = [
  "overview",
  "fx",
  "indices",
  "commodities",
  "rates",
  "macro",
  "correlations",
  "controls",
] as const;

export type AMTSection = (typeof AMT_SECTIONS)[number];
export type AMTClassSection = "fx" | "indices" | "commodities" | "rates";

export type AMTAssetDefinition = {
  symbol: string;
  label: string;
};

export const AMT_CLASS_ASSETS: Record<AMTClassSection, AMTAssetDefinition[]> = {
  fx: [
    { symbol: "EURUSD", label: "EUR/USD" },
    { symbol: "GBPUSD", label: "GBP/USD" },
    { symbol: "USDJPY", label: "USD/JPY" },
    { symbol: "AUDUSD", label: "AUD/USD" },
    { symbol: "USDCAD", label: "USD/CAD" },
    { symbol: "USDCHF", label: "USD/CHF" },
    { symbol: "EURJPY", label: "EUR/JPY" },
    { symbol: "GBPJPY", label: "GBP/JPY" },
  ],
  indices: [
    { symbol: "NAS100", label: "Nasdaq 100" },
    { symbol: "SPX500", label: "S&P 500" },
    { symbol: "DAX", label: "DAX 40" },
    { symbol: "DJI", label: "Dow Jones" },
    { symbol: "RUSSELL2000", label: "Russell 2000" },
    { symbol: "NIKKEI225", label: "Nikkei 225" },
    { symbol: "EUROSTOXX50", label: "Euro Stoxx 50" },
    { symbol: "FTSE100", label: "FTSE 100" },
  ],
  commodities: [
    { symbol: "XAUUSD", label: "Gold" },
    { symbol: "XAGUSD", label: "Silver" },
    { symbol: "WTICOUSD", label: "WTI Crude" },
    { symbol: "BCOUSD", label: "Brent Crude" },
    { symbol: "NATGASUSD", label: "Natural Gas" },
    { symbol: "COPPER", label: "Copper" },
  ],
  rates: [
    { symbol: "US2Y", label: "US 2Y" },
    { symbol: "US10Y", label: "US 10Y" },
    { symbol: "US30Y", label: "US 30Y" },
    { symbol: "BUND", label: "Bund" },
    { symbol: "GILT", label: "Gilt" },
  ],
};

const AMT_SECTION_SET = new Set<string>(AMT_SECTIONS);

const SECTION_ALIASES: Record<string, AMTSection> = {
  dashboard: "overview",
  signals: "overview",
  journal: "overview",
  forex: "fx",
  crypto: "macro",
  paper: "controls",
  settings: "controls",
};

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeAMTSection(section: string): AMTSection | null {
  const normalized = normalizeToken(section);
  if (AMT_SECTION_SET.has(normalized)) {
    return normalized as AMTSection;
  }
  return SECTION_ALIASES[normalized] ?? null;
}

export function isAMTClassSection(section: AMTSection): section is AMTClassSection {
  return section === "fx" || section === "indices" || section === "commodities" || section === "rates";
}

export function normalizeAMTAsset(section: AMTClassSection, asset: string): string | null {
  const normalizedAsset = normalizeSymbol(asset);
  const assetUniverse = AMT_CLASS_ASSETS[section];
  const match = assetUniverse.find(candidate => normalizeSymbol(candidate.symbol) === normalizedAsset);
  return match?.symbol ?? null;
}

export function getClassRoute(section: AMTClassSection, assetSymbol: string): string {
  return `/indices-v2/${section}/${assetSymbol.toLowerCase()}`;
}
