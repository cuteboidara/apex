import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import type { CryptoSymbol, CryptoVolatilityWindow } from "@/src/crypto/config/cryptoScope";

export type CryptoSignalCard = SignalViewModel & {
  assetClass: "crypto";
  marketSymbol: CryptoSymbol;
  displayName: string;
  volatilityWindow: CryptoVolatilityWindow;
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
};

export type CryptoSignalsPayload = {
  generatedAt: number;
  wsConnected: boolean;
  cycleRunning: boolean;
  lastCycleAt: number | null;
  cards: CryptoSignalCard[];
  executable: CryptoSignalCard[];
  monitored: CryptoSignalCard[];
  rejected: CryptoSignalCard[];
  liveMarketBoard: CryptoLiveMarketBoardRow[];
};
