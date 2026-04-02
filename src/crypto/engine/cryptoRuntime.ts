import { createId } from "@/src/lib/ids";
import { preferredProviderWarmupSymbol } from "@/src/assets/shared/providerHealth";
import { captureShadowTradePlans } from "@/src/application/outcomes/shadowTracker";
import {
  CRYPTO_ACTIVE_SYMBOLS,
  CRYPTO_DISPLAY_NAMES,
  getCryptoVolatilityWindow,
  type CryptoSymbol,
} from "@/src/crypto/config/cryptoScope";
import { isAssetModuleEnabled } from "@/src/config/assetActivation";
import { getCryptoLivePrice, isBinanceWsConnected, stopBinanceWebSocket } from "@/src/crypto/data/BinanceWebSocket";
import { fetchCryptoCandles, fetchCryptoTickerPrice } from "@/src/crypto/data/CryptoDataPlant";
import { runCryptoCycle } from "@/src/crypto/engine/CryptoEngine";
import type { CryptoLiveMarketBoardRow, CryptoSignalCard, CryptoSignalsPayload } from "@/src/crypto/types";
import { persistSignalViewModels } from "@/src/assets/shared/persistedSignalViewModel";

type CryptoRuntimeState = {
  latestCryptoCards: CryptoSignalCard[];
  lastCycleAt: number | null;
  cycleRunning: boolean;
};

const globalForCryptoRuntime = globalThis as typeof globalThis & {
  __apexCryptoRuntime?: CryptoRuntimeState;
};

const runtimeState = globalForCryptoRuntime.__apexCryptoRuntime ??= {
  latestCryptoCards: [],
  lastCycleAt: null,
  cycleRunning: false,
};

export function isCryptoRuntimeEnabled(): boolean {
  return process.env.APEX_ENABLE_CRYPTO !== "false" && isAssetModuleEnabled("crypto");
}

export function shutdownCryptoRuntime(): void {
  stopBinanceWebSocket();
}

async function warmCryptoProvider(): Promise<void> {
  const warmupSymbol = preferredProviderWarmupSymbol("crypto") as CryptoSymbol | null;
  if (!warmupSymbol) {
    return;
  }

  const [price, candles] = await Promise.all([
    fetchCryptoTickerPrice(warmupSymbol),
    fetchCryptoCandles(warmupSymbol),
  ]);

  if (price == null && candles.length === 0) {
    console.warn(`[crypto-runtime] Provider warmup failed for ${warmupSymbol}`);
  }
}

export async function triggerCryptoCycle(): Promise<{ cycleId: string; cardCount: number }> {
  if (!isCryptoRuntimeEnabled()) {
    return {
      cycleId: "crypto_disabled",
      cardCount: runtimeState.latestCryptoCards.length,
    };
  }

  if (runtimeState.cycleRunning) {
    return {
      cycleId: "crypto_skipped_running",
      cardCount: runtimeState.latestCryptoCards.length,
    };
  }

  runtimeState.cycleRunning = true;
  const cycleId = createId("cryptocycle");

  try {
    await warmCryptoProvider();
    const cards = await runCryptoCycle(cycleId);
    runtimeState.latestCryptoCards = cards;
    runtimeState.lastCycleAt = Date.now();
    await persistSignalViewModels(cards, { logPrefix: "APEX CRYPTO" });
    await captureShadowTradePlans({
      source: "crypto-runtime",
      assetClass: "crypto",
      cycleId,
      generatedAt: cards[0]?.generatedAt ?? runtimeState.lastCycleAt,
      cards,
    }).catch(error => {
      console.error("[crypto-runtime] Shadow trade capture failed:", error);
    });
    return {
      cycleId,
      cardCount: cards.length,
    };
  } finally {
    runtimeState.cycleRunning = false;
  }
}

export function getLatestCryptoCards(): CryptoSignalCard[] {
  return [...runtimeState.latestCryptoCards];
}

export function getCryptoRuntimeStatus(): {
  wsConnected: boolean;
  lastCycleAt: number | null;
  cardCount: number;
  cycleRunning: boolean;
} {
  return {
    wsConnected: isBinanceWsConnected(),
    lastCycleAt: runtimeState.lastCycleAt,
    cardCount: runtimeState.latestCryptoCards.length,
    cycleRunning: runtimeState.cycleRunning,
  };
}

function buildPlaceholderRow(symbol: CryptoSymbol): CryptoLiveMarketBoardRow {
  const window = getCryptoVolatilityWindow(new Date().getUTCHours());
  return {
    symbol,
    displayName: CRYPTO_DISPLAY_NAMES[symbol],
    livePrice: getCryptoLivePrice(symbol),
    direction: "neutral",
    grade: null,
    status: "watchlist",
    volatilityWindow: window,
    noTradeReason: runtimeState.lastCycleAt == null ? "cycle not run" : "data unavailable",
    marketStateLabels: ["24/7", window.replaceAll("_", " ")],
    smcScore: 0,
    pdLocation: "equilibrium",
    inOTE: false,
  };
}

function buildLiveMarketBoard(cards: CryptoSignalCard[]): CryptoLiveMarketBoardRow[] {
  const cardsBySymbol = new Map(cards.map(card => [card.marketSymbol, card]));

  return CRYPTO_ACTIVE_SYMBOLS.map(symbol => {
    const card = cardsBySymbol.get(symbol);
    if (!card) {
      return buildPlaceholderRow(symbol);
    }

    return {
      symbol,
      displayName: card.displayName,
      livePrice: card.livePrice,
      direction: card.direction,
      grade: card.grade,
      status: card.status,
      volatilityWindow: card.volatilityWindow,
      noTradeReason: card.noTradeReason,
      marketStateLabels: card.marketStateLabels,
      smcScore: card.smcAnalysis?.smcScore ?? 0,
      pdLocation: card.smcAnalysis?.pdLocation ?? "equilibrium",
      inOTE: card.smcAnalysis?.inOTE ?? false,
    };
  });
}

export function getCryptoSignalsPayload(): CryptoSignalsPayload {
  const cards = getLatestCryptoCards();

  return {
    generatedAt: runtimeState.lastCycleAt ?? Date.now(),
    wsConnected: isBinanceWsConnected(),
    cycleRunning: runtimeState.cycleRunning,
    lastCycleAt: runtimeState.lastCycleAt,
    cards,
    executable: cards.filter(card => card.displayCategory === "executable"),
    monitored: cards.filter(card => card.displayCategory === "monitored"),
    rejected: cards.filter(card => card.displayCategory === "rejected"),
    liveMarketBoard: buildLiveMarketBoard(cards),
  };
}

export function resetCryptoRuntimeForTests(): void {
  shutdownCryptoRuntime();
  runtimeState.latestCryptoCards = [];
  runtimeState.lastCycleAt = null;
  runtimeState.cycleRunning = false;
}
