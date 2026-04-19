import { createId } from "@/src/lib/ids";
import { preferredProviderWarmupSymbol } from "@/src/assets/shared/providerHealth";
import { captureShadowTradePlans } from "@/src/application/outcomes/shadowTracker";
import {
  CRYPTO_ACTIVE_SYMBOLS,
  getCryptoVolatilityWindow,
  getCryptoDisplayName,
  type CryptoSymbol,
} from "@/src/crypto/config/cryptoScope";
import { isAssetModuleEnabled } from "@/src/config/assetActivation";
import {
  getCryptoLivePrice,
  isBinanceWsConnected,
  startBinanceWebSocket,
  stopBinanceWebSocket,
  waitForBinanceWebSocket,
} from "@/src/crypto/data/BinanceWebSocket";
import { fetchCryptoCandles, fetchCryptoTickerPrice } from "@/src/crypto/data/CryptoDataPlant";
import { runCryptoCycle, selectTradableAssets } from "@/src/crypto/engine/CryptoEngine";
import type {
  CryptoLiveMarketBoardRow,
  CryptoSelectedAsset,
  CryptoSignalCard,
  CryptoSignalsPayload,
} from "@/src/crypto/types";
import { persistSignalViewModels } from "@/src/assets/shared/persistedSignalViewModel";

type CryptoRuntimeState = {
  latestCryptoCards: CryptoSignalCard[];
  lastCycleAt: number | null;
  cycleRunning: boolean;
  selectedAssets: CryptoSelectedAsset[];
  selectionGeneratedAt: number | null;
  selectionProvider: string | null;
};

const globalForCryptoRuntime = globalThis as typeof globalThis & {
  __apexCryptoRuntime?: CryptoRuntimeState;
};

const runtimeState = globalForCryptoRuntime.__apexCryptoRuntime ??= {
  latestCryptoCards: [],
  lastCycleAt: null,
  cycleRunning: false,
  selectedAssets: [],
  selectionGeneratedAt: null,
  selectionProvider: null,
};

function isServerlessCryptoRuntime(): boolean {
  return process.env.VERCEL === "1" || process.env.VERCEL_ENV != null;
}

export function isCryptoRuntimeEnabled(): boolean {
  return process.env.APEX_ENABLE_CRYPTO !== "false" && isAssetModuleEnabled("crypto");
}

export function shutdownCryptoRuntime(): void {
  stopBinanceWebSocket();
}

function ensureCryptoLiveFeedsStarted(symbols?: string[]): void {
  if (!isCryptoRuntimeEnabled()) {
    return;
  }

  startBinanceWebSocket(symbols);
}

async function warmCryptoProvider(): Promise<void> {
  const warmupSymbol = preferredProviderWarmupSymbol("crypto") as CryptoSymbol | null;
  if (!warmupSymbol) {
    return;
  }

  ensureCryptoLiveFeedsStarted();
  const wsReady = isServerlessCryptoRuntime() ? false : await waitForBinanceWebSocket();
  const [price, candles] = await Promise.all([
    fetchCryptoTickerPrice(warmupSymbol),
    fetchCryptoCandles(warmupSymbol),
  ]);

  console.log(
    `[crypto-runtime] Warmup ${warmupSymbol}: wsConnected=${isBinanceWsConnected()} wsReady=${wsReady} restPrice=${price ?? "null"} candleCount=${candles.length}`,
  );

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

  const selection = await selectTradableAssets();
  ensureCryptoLiveFeedsStarted(selection.assets.map(asset => asset.symbol));
  if (isServerlessCryptoRuntime()) {
    console.log("[crypto-runtime] Serverless execution detected, skipping websocket wait and relying on Binance REST fallbacks.");
  } else {
    await waitForBinanceWebSocket(1_500, selection.assets.map(asset => asset.symbol));
  }
  runtimeState.cycleRunning = true;
  const cycleId = createId("cryptocycle");

  try {
    await warmCryptoProvider();
    const result = await runCryptoCycle(cycleId, selection);
    const cards = result.cards;
    runtimeState.latestCryptoCards = cards;
    runtimeState.lastCycleAt = Date.now();
    runtimeState.selectedAssets = result.selection.assets;
    runtimeState.selectionGeneratedAt = result.selection.generatedAt;
    runtimeState.selectionProvider = result.selection.provider;
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
  ensureCryptoLiveFeedsStarted();
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
    displayName: getCryptoDisplayName(symbol),
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
    news: [],
  };
}

function buildLiveMarketBoard(cards: CryptoSignalCard[]): CryptoLiveMarketBoardRow[] {
  const cardsBySymbol = new Map(cards.map(card => [card.marketSymbol, card]));
  const scopedSymbols = runtimeState.selectedAssets.length > 0
    ? runtimeState.selectedAssets.map(asset => asset.symbol)
    : [...CRYPTO_ACTIVE_SYMBOLS];

  return scopedSymbols.map(symbol => {
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
      news: card.news,
    };
  });
}

export function getCryptoSignalsPayload(): CryptoSignalsPayload {
  ensureCryptoLiveFeedsStarted(runtimeState.selectedAssets.map(asset => asset.symbol));
  const cards = getLatestCryptoCards();

  return {
    generatedAt: runtimeState.lastCycleAt ?? Date.now(),
    wsConnected: isBinanceWsConnected(),
    cycleRunning: runtimeState.cycleRunning,
    lastCycleAt: runtimeState.lastCycleAt,
    selectionGeneratedAt: runtimeState.selectionGeneratedAt,
    selectionProvider: runtimeState.selectionProvider,
    selectedAssets: [...runtimeState.selectedAssets],
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
  runtimeState.selectedAssets = [];
  runtimeState.selectionGeneratedAt = null;
  runtimeState.selectionProvider = null;
}
