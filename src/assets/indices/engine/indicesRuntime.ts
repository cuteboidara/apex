import {
  INDEX_DISPLAY_NAMES,
  INDICES_SYMBOLS,
  getIndexCategory,
  isIndexMarketOpen,
  type IndexSymbol,
} from "@/src/assets/indices/config/indicesScope";
import { isAssetModuleEnabled } from "@/src/config/assetActivation";
import { runIndicesCycle, warmIndexProviders } from "@/src/assets/indices/engine/IndicesEngine";
import { persistSignalViewModels } from "@/src/assets/shared/persistedSignalViewModel";
import type { IndexSignalCard, IndicesLiveMarketBoardRow, IndicesSignalsPayload } from "@/src/assets/indices/types";
import { captureShadowTradePlans } from "@/src/application/outcomes/shadowTracker";
import { createId } from "@/src/lib/ids";
import { TelegramNotifier } from "@/src/lib/telegram";

type IndicesRuntimeState = {
  latestCards: IndexSignalCard[];
  lastCycleAt: number | null;
  cycleRunning: boolean;
};

const globalForIndicesRuntime = globalThis as typeof globalThis & {
  __apexIndicesRuntime?: IndicesRuntimeState;
};

const runtimeState = globalForIndicesRuntime.__apexIndicesRuntime ??= {
  latestCards: [],
  lastCycleAt: null,
  cycleRunning: false,
};

export async function triggerIndicesCycle(): Promise<{ cycleId: string; cardCount: number }> {
  if (!isAssetModuleEnabled("indices")) {
    return {
      cycleId: "indices_disabled",
      cardCount: runtimeState.latestCards.length,
    };
  }

  if (runtimeState.cycleRunning) {
    return {
      cycleId: "indices_skipped_running",
      cardCount: runtimeState.latestCards.length,
    };
  }

  runtimeState.cycleRunning = true;
  const cycleId = createId("indexcycle");
  try {
    await warmIndexProviders().catch(error => {
      console.warn("[indices-runtime] Provider warmup failed:", error);
    });
    runtimeState.latestCards = await runIndicesCycle(cycleId);
    runtimeState.lastCycleAt = Date.now();
    await persistSignalViewModels(runtimeState.latestCards, { logPrefix: "APEX INDICES" });
    const telegramAlertsSent = await new TelegramNotifier().sendMarketSignalAlerts(runtimeState.latestCards, {
      assetLabel: "Indices",
      messageType: "index_signal",
    });
    console.log(`[indices-runtime] Telegram alerts sent: ${telegramAlertsSent}`);
    await captureShadowTradePlans({
      source: "index-runtime",
      assetClass: "index",
      cycleId,
      generatedAt: runtimeState.latestCards[0]?.generatedAt ?? runtimeState.lastCycleAt,
      cards: runtimeState.latestCards,
    }).catch(error => {
      console.error("[indices-runtime] Shadow trade capture failed:", error);
    });
    return {
      cycleId,
      cardCount: runtimeState.latestCards.length,
    };
  } finally {
    runtimeState.cycleRunning = false;
  }
}

export function getLatestIndicesCards(): IndexSignalCard[] {
  return [...runtimeState.latestCards];
}

function buildPlaceholderRow(symbol: IndexSymbol): IndicesLiveMarketBoardRow {
  return {
    symbol,
    displayName: INDEX_DISPLAY_NAMES[symbol],
    category: getIndexCategory(symbol),
    livePrice: null,
    direction: "neutral",
    grade: null,
    status: "watchlist",
    marketOpen: isIndexMarketOpen(symbol),
    noTradeReason: runtimeState.lastCycleAt == null ? "cycle not run" : "data unavailable",
    marketStateLabels: [
      getIndexCategory(symbol),
      "STOOQ",
    ],
    regime: "ranging",
    dataSource: null,
  };
}

function buildLiveMarketBoard(cards: IndexSignalCard[]): IndicesLiveMarketBoardRow[] {
  const cardsBySymbol = new Map(cards.map(card => [card.marketSymbol, card]));
  return INDICES_SYMBOLS.map(symbol => {
    const card = cardsBySymbol.get(symbol);
    if (!card) {
      return buildPlaceholderRow(symbol);
    }
    return {
      symbol,
      displayName: card.displayName,
      category: card.category,
      livePrice: card.livePrice,
      direction: card.direction,
      grade: card.grade,
      status: card.status,
      marketOpen: card.marketOpen,
      noTradeReason: card.noTradeReason,
      marketStateLabels: card.marketStateLabels,
      regime: card.regime,
      dataSource: card.dataSource,
    };
  });
}

export function getIndicesRuntimeStatus() {
  return {
    lastCycleAt: runtimeState.lastCycleAt,
    cardCount: runtimeState.latestCards.length,
    cycleRunning: runtimeState.cycleRunning,
  };
}

export function getIndicesSignalsPayload(): IndicesSignalsPayload {
  const enabled = isAssetModuleEnabled("indices");
  const cards = enabled ? getLatestIndicesCards() : [];
  const providerStatus = cards.length === 0
    ? "no_data"
    : cards.some(card => card.dataSource.startsWith("cached"))
      ? "degraded_cached"
      : cards.some(card => card.dataSource === "yahoo")
        ? "degraded_yahoo_fallback"
        : "healthy_stooq";
  const providerNotice = providerStatus === "healthy_stooq"
    ? "Free Stooq benchmark feed active."
    : providerStatus === "degraded_yahoo_fallback"
      ? "Stooq returned no usable data. Yahoo chart fallback is active for benchmark indices."
      : providerStatus === "degraded_cached"
        ? "Index analysis is using cached benchmark candles because live feeds were unavailable."
        : "Run an indices cycle to populate benchmark data.";

  return {
    enabled,
    generatedAt: runtimeState.lastCycleAt ?? Date.now(),
    lastCycleAt: runtimeState.lastCycleAt,
    cycleRunning: runtimeState.cycleRunning,
    providerName: "Stooq / Yahoo",
    providerStatus,
    providerNotice: enabled ? providerNotice : "Indices module disabled by asset controls.",
    cards,
    executable: cards.filter(card => card.displayCategory === "executable"),
    monitored: cards.filter(card => card.displayCategory === "monitored"),
    rejected: cards.filter(card => card.displayCategory === "rejected"),
    liveMarketBoard: buildLiveMarketBoard(cards),
  };
}
