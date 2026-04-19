import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import type { CryptoSymbol, CryptoVolatilityWindow } from "@/src/crypto/config/cryptoScope";

export type CryptoNewsSentiment = "bullish" | "bearish" | "neutral";

export type CryptoNewsItem = {
  headline: string;
  source: string;
  url: string;
  sentiment: CryptoNewsSentiment;
  publishedAt: string;
};

export type CryptoSelectedAsset = {
  symbol: CryptoSymbol;
  displayName: string;
  label: string;
  short: string;
  tv: string;
  coingeckoId: string | null;
  quoteVolume24h: number | null;
  priceChangePct24h: number | null;
  lastPrice: number | null;
  selectionRank: number;
  selectionReasons: string[];
};

export type CryptoSelectionSnapshot = {
  generatedAt: number;
  provider: string;
  assets: CryptoSelectedAsset[];
};

export type CryptoSignalCard = SignalViewModel & {
  assetClass: "crypto";
  marketSymbol: CryptoSymbol;
  displayName: string;
  volatilityWindow: CryptoVolatilityWindow;
  news: CryptoNewsItem[];
  newsSentimentModifier: number;
};

export type CryptoLiveMarketBoardRow = {
  symbol: CryptoSymbol;
  displayName: string;
  livePrice: number | null;
  direction: CryptoSignalCard["direction"];
  grade: string | null;
  status: CryptoSignalCard["status"];
  volatilityWindow: CryptoVolatilityWindow;
  noTradeReason: string | null;
  marketStateLabels: string[];
  smcScore: number;
  pdLocation: "premium" | "discount" | "equilibrium";
  inOTE: boolean;
  news: CryptoNewsItem[];
};

export type CryptoSignalsPayload = {
  generatedAt: number;
  wsConnected: boolean;
  cycleRunning: boolean;
  lastCycleAt: number | null;
  selectionGeneratedAt: number | null;
  selectionProvider: string | null;
  selectedAssets: CryptoSelectedAsset[];
  cards: CryptoSignalCard[];
  executable: CryptoSignalCard[];
  monitored: CryptoSignalCard[];
  rejected: CryptoSignalCard[];
  liveMarketBoard: CryptoLiveMarketBoardRow[];
};
