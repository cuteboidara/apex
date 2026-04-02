import { getLastCoinDiscoveryAt, runCoinDiscovery } from "@/src/assets/memecoins/data/CoinGeckoDiscovery";
import {
  getMemeBinanceLivePrice,
  fetchMemeBinanceTickerPrice,
  isMemeBinanceWsConnected,
} from "@/src/assets/memecoins/data/BinanceMemeMarketData";
import { runMemeCycle } from "@/src/assets/memecoins/engine/MemeEngine";
import type { MemeLiveMarketBoardRow, MemeSignalCard, MemeSignalsPayload } from "@/src/assets/memecoins/types";
import { getMemeUniverse } from "@/src/assets/memecoins/config/memeScope";
import { createId } from "@/src/lib/ids";
import { preferredProviderWarmupSymbol } from "@/src/assets/shared/providerHealth";
import { captureShadowTradePlans } from "@/src/application/outcomes/shadowTracker";
import { isAssetModuleEnabled } from "@/src/config/assetActivation";

type MemeRuntimeState = {
  latestCards: MemeSignalCard[];
  lastCycleAt: number | null;
  lastDiscoveryAt: number | null;
  cycleRunning: boolean;
  discoveryRunning: boolean;
};

const globalForMemeRuntime = globalThis as typeof globalThis & {
  __apexMemeRuntime?: MemeRuntimeState;
};

const runtimeState = globalForMemeRuntime.__apexMemeRuntime ??= {
  latestCards: [],
  lastCycleAt: null,
  lastDiscoveryAt: null,
  cycleRunning: false,
  discoveryRunning: false,
};

async function warmMemeProviders(): Promise<void> {
  const warmupSymbol = preferredProviderWarmupSymbol("memecoin");
  if (!warmupSymbol) {
    return;
  }

  const price = await fetchMemeBinanceTickerPrice(warmupSymbol);
  if (price == null) {
    console.warn(`[meme-runtime] Provider warmup failed for ${warmupSymbol}`);
  }
}

function overlayLivePrice(card: MemeSignalCard): MemeSignalCard {
  if (!card.binanceListed) {
    return card;
  }

  const livePrice = getMemeBinanceLivePrice(card.marketSymbol) ?? card.livePrice;
  return {
    ...card,
    livePrice,
  };
}

function buildPlaceholderRow(symbol: string): MemeLiveMarketBoardRow {
  const profile = getMemeUniverse().find(entry => entry.symbol === symbol);
  const wsPrice = getMemeBinanceLivePrice(symbol);
  return {
    symbol,
    displayName: profile?.displayName ?? symbol.replace(/USDT$/u, ""),
    livePrice: wsPrice,
    direction: "neutral",
    grade: null,
    status: "watchlist",
    volumeSpike: false,
    volumeSpikeStrength: "none",
    priceChange24h: null,
    marketCapRank: profile?.marketCapRank ?? null,
    noTradeReason: runtimeState.lastCycleAt == null ? "cycle not run" : "data unavailable",
    isBase: profile?.isBase ?? false,
    dataSource: profile?.binanceListed === false ? "coingecko" : "binance",
    pdLocation: "equilibrium",
    marketStateLabels: [profile?.isBase ? "established meme" : "trending coin"],
  };
}

function buildLiveMarketBoard(cards: MemeSignalCard[]): MemeLiveMarketBoardRow[] {
  const cardsBySymbol = new Map(cards.map(card => [card.marketSymbol, overlayLivePrice(card)]));
  return getMemeUniverse().map(profile => {
    const card = cardsBySymbol.get(profile.symbol);
    if (!card) {
      return buildPlaceholderRow(profile.symbol);
    }

    return {
      symbol: profile.symbol,
      displayName: card.displayName,
      livePrice: card.livePrice,
      direction: card.direction,
      grade: card.grade,
      status: card.status,
      volumeSpike: card.volumeSpike,
      volumeSpikeStrength: card.volumeSpikeStrength,
      priceChange24h: card.priceChange24h,
      marketCapRank: card.marketCapRank,
      noTradeReason: card.noTradeReason,
      isBase: card.isBase,
      dataSource: card.dataSource,
      pdLocation: card.smcAnalysis?.pdLocation ?? card.location,
      marketStateLabels: card.marketStateLabels,
    };
  });
}

export async function triggerMemeCycle(): Promise<{ cycleId: string; cardCount: number; universeSize: number }> {
  if (!isAssetModuleEnabled("memecoins")) {
    return {
      cycleId: "meme_disabled",
      cardCount: runtimeState.latestCards.length,
      universeSize: getMemeUniverse().length,
    };
  }

  if (runtimeState.cycleRunning) {
    return {
      cycleId: "meme_skipped_running",
      cardCount: runtimeState.latestCards.length,
      universeSize: getMemeUniverse().length,
    };
  }

  runtimeState.cycleRunning = true;
  const cycleId = createId("memecycle");

  try {
    await warmMemeProviders();
    runtimeState.latestCards = await runMemeCycle(cycleId);
    runtimeState.lastCycleAt = Date.now();
    await captureShadowTradePlans({
      source: "meme-runtime",
      assetClass: "memecoin",
      cycleId,
      generatedAt: runtimeState.latestCards[0]?.generatedAt ?? runtimeState.lastCycleAt,
      cards: runtimeState.latestCards,
    }).catch(error => {
      console.error("[meme-runtime] Shadow trade capture failed:", error);
    });
    return {
      cycleId,
      cardCount: runtimeState.latestCards.length,
      universeSize: getMemeUniverse().length,
    };
  } finally {
    runtimeState.cycleRunning = false;
  }
}

export async function triggerDiscoveryNow(): Promise<void> {
  if (runtimeState.discoveryRunning) {
    return;
  }

  runtimeState.discoveryRunning = true;
  try {
    await runCoinDiscovery({ force: true });
    runtimeState.lastDiscoveryAt = getLastCoinDiscoveryAt() ?? Date.now();
  } finally {
    runtimeState.discoveryRunning = false;
  }
}

export function getLatestMemeCards(): MemeSignalCard[] {
  return runtimeState.latestCards.map(overlayLivePrice);
}

export function getMemeRuntimeStatus() {
  return {
    lastCycleAt: runtimeState.lastCycleAt,
    lastDiscoveryAt: runtimeState.lastDiscoveryAt,
    cardCount: runtimeState.latestCards.length,
    cycleRunning: runtimeState.cycleRunning,
    discoveryRunning: runtimeState.discoveryRunning,
    wsConnected: isMemeBinanceWsConnected(),
  };
}

export function getMemeSignalsPayload(): MemeSignalsPayload {
  const cards = getLatestMemeCards();
  const status = getMemeRuntimeStatus();
  const universe = getMemeUniverse();

  return {
    generatedAt: status.lastCycleAt ?? Date.now(),
    lastCycleAt: status.lastCycleAt,
    lastDiscoveryAt: status.lastDiscoveryAt,
    cardCount: status.cardCount,
    cycleRunning: status.cycleRunning,
    discoveryRunning: status.discoveryRunning,
    wsConnected: status.wsConnected,
    universeSize: universe.length,
    universe: universe.map(profile => ({
      symbol: profile.symbol,
      displayName: profile.displayName,
      isBase: profile.isBase,
      binanceListed: profile.binanceListed,
      marketCapRank: profile.marketCapRank,
      addedAt: profile.addedAt,
    })),
    cards,
    executable: cards.filter(card => card.displayCategory === "executable"),
    monitored: cards.filter(card => card.displayCategory === "monitored"),
    rejected: cards.filter(card => card.displayCategory === "rejected"),
    liveMarketBoard: buildLiveMarketBoard(cards),
  };
}
