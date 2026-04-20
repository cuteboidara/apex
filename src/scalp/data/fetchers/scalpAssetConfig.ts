import type { ScalpAssetConfig } from "@/src/scalp/types/scalpTypes";

export const scalpAssetConfig = {
  EURUSD: { symbol: "EURUSD=X", pipSize: 0.0001, category: "FX", preferredSessions: ["london", "overlap", "ny"] },
  GBPUSD: { symbol: "GBPUSD=X", pipSize: 0.0001, category: "FX", preferredSessions: ["london", "overlap", "ny"] },
  USDJPY: { symbol: "JPY=X", pipSize: 0.01, category: "FX", preferredSessions: ["tokyo", "ny"] },
  AUDUSD: { symbol: "AUDUSD=X", pipSize: 0.0001, category: "FX", preferredSessions: ["tokyo", "overlap"] },
  USDCAD: { symbol: "CAD=X", pipSize: 0.0001, category: "FX", preferredSessions: ["ny"] },

  EURJPY: { symbol: "EURJPY=X", pipSize: 0.01, category: "FX", preferredSessions: ["london", "tokyo"] },
  GBPJPY: { symbol: "GBPJPY=X", pipSize: 0.01, category: "FX", preferredSessions: ["london", "tokyo"] },

  XAUUSD: { symbol: "GC=F", pipSize: 0.1, category: "METAL", preferredSessions: ["london", "overlap", "ny"] },
  XAGUSD: { symbol: "SI=F", pipSize: 0.005, category: "METAL", preferredSessions: ["london", "ny"] },

  NAS100: { symbol: "NQ=F", pipSize: 0.25, category: "INDEX", preferredSessions: ["ny", "overlap"] },
  SPX500: { symbol: "ES=F", pipSize: 0.25, category: "INDEX", preferredSessions: ["ny", "overlap"] },
  DAX: { symbol: "^GDAXI", pipSize: 0.5, category: "INDEX", preferredSessions: ["london", "overlap"] },

  BTCUSD: { symbol: "BTC-USD", pipSize: 1, category: "CRYPTO", preferredSessions: ["london", "ny", "overlap", "tokyo"] },
  ETHUSD: { symbol: "ETH-USD", pipSize: 0.1, category: "CRYPTO", preferredSessions: ["london", "ny", "overlap", "tokyo"] },
} as const satisfies Record<string, ScalpAssetConfig>;

export type ScalpAssetId = keyof typeof scalpAssetConfig;
export const SCALP_ASSETS = Object.keys(scalpAssetConfig) as ScalpAssetId[];
