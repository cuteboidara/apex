import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import type { IndexCategory, IndexSymbol } from "@/src/assets/indices/config/indicesScope";
import type { MarketRegime } from "@/src/assets/indices/strategies/macroRegime";

export type IndexSignalCard = SignalViewModel & {
  assetClass: "index";
  marketSymbol: IndexSymbol;
  displayName: string;
  category: IndexCategory;
  marketOpen: boolean;
  regime: MarketRegime;
  regimeNote: string;
  dataSource: "stooq" | "yahoo" | "cached_stooq" | "cached_yahoo";
};

export type IndicesLiveMarketBoardRow = {
  symbol: IndexSymbol;
  displayName: string;
  category: IndexCategory;
  livePrice: number | null;
  direction: IndexSignalCard["direction"];
  grade: string | null;
  status: IndexSignalCard["status"];
  marketOpen: boolean;
  noTradeReason: string | null;
  marketStateLabels: string[];
  regime: MarketRegime;
  dataSource: IndexSignalCard["dataSource"] | null;
};

export type IndicesSignalsPayload = {
  enabled: boolean;
  generatedAt: number;
  lastCycleAt: number | null;
  cycleRunning: boolean;
  providerName?: string;
  providerStatus?: "ready" | "healthy_stooq" | "healthy" | "degraded" | "broken" | "degraded_yahoo_fallback" | "degraded_cached" | "no_data" | "plan_upgrade_required" | "not_configured";
  providerNotice?: string | null;
  cards: IndexSignalCard[];
  executable: IndexSignalCard[];
  monitored: IndexSignalCard[];
  rejected: IndexSignalCard[];
  liveMarketBoard: IndicesLiveMarketBoardRow[];
};
