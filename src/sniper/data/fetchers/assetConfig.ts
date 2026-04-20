export const sniperAssetConfig = {
  EURUSD: {
    symbol: "EURUSD=X",
    pipSize: 0.0001,
    category: "FX",
    preferredSessions: ["london", "ny", "overlap"] as const,
  },
  GBPUSD: {
    symbol: "GBPUSD=X",
    pipSize: 0.0001,
    category: "FX",
    preferredSessions: ["london", "ny", "overlap"] as const,
  },
  USDJPY: {
    symbol: "JPY=X",
    pipSize: 0.01,
    category: "FX",
    preferredSessions: ["tokyo", "ny"] as const,
  },
  EURJPY: {
    symbol: "EURJPY=X",
    pipSize: 0.01,
    category: "FX",
    preferredSessions: ["london", "tokyo"] as const,
  },
  GBPJPY: {
    symbol: "GBPJPY=X",
    pipSize: 0.01,
    category: "FX",
    preferredSessions: ["london", "tokyo"] as const,
  },
  AUDUSD: {
    symbol: "AUDUSD=X",
    pipSize: 0.0001,
    category: "FX",
    preferredSessions: ["tokyo", "overlap"] as const,
  },
  NAS100: {
    symbol: "NQ=F",
    pipSize: 0.25,
    category: "INDEX",
    preferredSessions: ["ny"] as const,
  },
  SPX500: {
    symbol: "ES=F",
    pipSize: 0.25,
    category: "INDEX",
    preferredSessions: ["ny"] as const,
  },
  US30: {
    symbol: "^DJI",
    pipSize: 1,
    category: "INDEX",
    preferredSessions: ["ny", "overlap"] as const,
  },
  UK100: {
    symbol: "^FTSE",
    pipSize: 0.5,
    category: "INDEX",
    preferredSessions: ["london", "overlap"] as const,
  },
  DAX: {
    symbol: "^GDAXI",
    pipSize: 0.5,
    category: "INDEX",
    preferredSessions: ["london"] as const,
  },
  XAUUSD: {
    symbol: "GC=F",
    pipSize: 0.1,
    category: "METAL",
    preferredSessions: ["london", "ny", "overlap"] as const,
  },
} as const;

export type SniperAssetId = keyof typeof sniperAssetConfig;
export type SniperAssetConfig = (typeof sniperAssetConfig)[SniperAssetId];
export const SNIPER_ASSETS = Object.keys(sniperAssetConfig) as SniperAssetId[];
