import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import type { StockCategory, StockSymbol } from "@/src/assets/stocks/config/stocksScope";

export type StockSignalCard = SignalViewModel & {
  assetClass: "stock";
  marketSymbol: StockSymbol;
  displayName: string;
  category: StockCategory;
  dataSource: "yahoo_day" | "cached_yahoo_day" | "none";
  marketOpen: boolean;
  trendDirection: "bullish" | "bearish" | "neutral";
  trendStrength: "strong" | "moderate" | "weak";
  ema20: number;
  ema50: number;
  ema200: number;
  momentum: number;
  earningsSetup: string;
  earningsNote: string;
  daysUntilEarnings: number | null;
};

export type StocksLiveMarketBoardRow = {
  symbol: StockSymbol;
  displayName: string;
  category: StockCategory;
  livePrice: number | null;
  direction: StockSignalCard["direction"];
  grade: string | null;
  status: StockSignalCard["status"];
  marketOpen: boolean;
  noTradeReason: string | null;
  marketStateLabels: string[];
  trendDirection: StockSignalCard["trendDirection"];
  daysUntilEarnings: number | null;
  dataSource: StockSignalCard["dataSource"] | null;
};

export type StocksSignalsPayload = {
  enabled: boolean;
  generatedAt: number;
  lastCycleAt: number | null;
  cycleRunning: boolean;
  providerName?: string;
  providerStatus?: "ready" | "healthy" | "degraded" | "broken" | "no_data" | "plan_upgrade_required" | "not_configured";
  providerNotice?: string | null;
  cards: StockSignalCard[];
  executable: StockSignalCard[];
  monitored: StockSignalCard[];
  rejected: StockSignalCard[];
  liveMarketBoard: StocksLiveMarketBoardRow[];
};
