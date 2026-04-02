import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import type { CommodityCategory, CommoditySymbol } from "@/src/assets/commodities/config/commoditiesScope";

export type CommoditySignalCard = SignalViewModel & {
  assetClass: "commodity";
  marketSymbol: CommoditySymbol;
  displayName: string;
  category: CommodityCategory;
  macroNote: string;
  macroDirectionBias: "bullish" | "bearish" | "neutral";
  dataSource: "yahoo" | "cached_yahoo" | "none";
};

export type CommoditiesLiveMarketBoardRow = {
  symbol: CommoditySymbol;
  displayName: string;
  category: CommodityCategory;
  livePrice: number | null;
  direction: CommoditySignalCard["direction"];
  grade: string | null;
  status: CommoditySignalCard["status"];
  noTradeReason: string | null;
  marketStateLabels: string[];
  macroDirectionBias: CommoditySignalCard["macroDirectionBias"];
  dataSource: string | null;
};

export type CommoditiesSignalsPayload = {
  enabled: boolean;
  generatedAt: number;
  lastCycleAt: number | null;
  cycleRunning: boolean;
  providerName?: string;
  providerStatus?: "ready" | "healthy" | "degraded" | "broken" | "degraded_stooq_fallback" | "degraded_yahoo_fallback" | "degraded_cached" | "no_data" | "not_configured";
  providerNotice?: string | null;
  cards: CommoditySignalCard[];
  executable: CommoditySignalCard[];
  monitored: CommoditySignalCard[];
  rejected: CommoditySignalCard[];
  liveMarketBoard: CommoditiesLiveMarketBoardRow[];
};
