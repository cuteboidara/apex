import type { SignalViewModel } from "@/src/domain/models/signalPipeline";

export type MemeSignalCard = SignalViewModel & {
  assetClass: "memecoin";
  marketSymbol: string;
  displayName: string;
  coingeckoId: string;
  isBase: boolean;
  binanceListed: boolean;
  dataSource: "binance" | "coingecko";
  marketCapRank: number | null;
  priceChange24h: number | null;
  volume24h: number | null;
  primaryDriver: string;
  volumeSpike: boolean;
  volumeSpikeMultiplier: number;
  volumeSpikeStrength: string;
  volumeNote: string;
};

export type MemeUniverseEntry = {
  symbol: string;
  displayName: string;
  isBase: boolean;
  binanceListed: boolean;
  marketCapRank: number | null;
  addedAt: number;
};

export type MemeLiveMarketBoardRow = {
  symbol: string;
  displayName: string;
  livePrice: number | null;
  direction: MemeSignalCard["direction"];
  grade: string | null;
  status: MemeSignalCard["status"];
  volumeSpike: boolean;
  volumeSpikeStrength: string;
  priceChange24h: number | null;
  marketCapRank: number | null;
  noTradeReason: string | null;
  isBase: boolean;
  dataSource: MemeSignalCard["dataSource"];
  pdLocation: string;
  marketStateLabels: string[];
};

export type MemeSignalsPayload = {
  generatedAt: number;
  lastCycleAt: number | null;
  lastDiscoveryAt: number | null;
  cardCount: number;
  cycleRunning: boolean;
  discoveryRunning: boolean;
  wsConnected: boolean;
  universeSize: number;
  universe: MemeUniverseEntry[];
  cards: MemeSignalCard[];
  executable: MemeSignalCard[];
  monitored: MemeSignalCard[];
  rejected: MemeSignalCard[];
  liveMarketBoard: MemeLiveMarketBoardRow[];
};

export type MemeScannerChain = "solana" | "ethereum" | "base" | "bsc";
export type MemeScannerSignal = "STRONG_BUY" | "WATCH" | "NEUTRAL" | "AVOID";
export type MemeScannerGrade = "S" | "A" | "B" | "C" | "F";
export type MemeTrendSource = "reddit" | "twitter" | "news";

export type MemeScannerCoin = {
  id: string;
  name: string;
  symbol: string;
  chain: MemeScannerChain;
  marketCap: number;
  volume1h: number;
  volume24h: number;
  liquidity: number;
  holders: number;
  priceUsd: number;
  priceChange1h: number;
  priceChange24h: number;
  age: string;
  contractAddress: string;
  imageUrl?: string;
  dexUrl?: string;
  launchedAt: number;
};

export type ScoredMemeScannerCoin = MemeScannerCoin & {
  apexScore: number;
  grade: MemeScannerGrade;
  signal: MemeScannerSignal;
  reasoning: string;
  flags: string[];
};

export type MemeScannerPayload = {
  generatedAt: number;
  alertsSent: number;
  coins: ScoredMemeScannerCoin[];
};

export type MemeTrendRadarItem = {
  id: string;
  title: string;
  source: MemeTrendSource;
  sourceUrl: string;
  engagementScore: number;
  coinPotentialScore: number;
  grade: MemeScannerGrade;
  suggestedCoinName: string;
  suggestedSymbol: string;
  reasoning: string;
  tags: string[];
};

export type MemeTrendRadarPayload = {
  generatedAt: number;
  trends: MemeTrendRadarItem[];
};
