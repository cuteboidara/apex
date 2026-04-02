import {
  ALL_COMMODITY_SYMBOLS,
  COMMODITY_DISPLAY_NAMES,
  getCommodityCategory,
  type CommoditySymbol,
} from "@/src/assets/commodities/config/commoditiesScope";
import { isAssetModuleEnabled } from "@/src/config/assetActivation";
import { getCommodityProviderSummary, runCommoditiesCycle, warmCommodityProviders } from "@/src/assets/commodities/engine/CommoditiesEngine";
import { persistSignalViewModels } from "@/src/assets/shared/persistedSignalViewModel";
import type {
  CommoditySignalCard,
  CommoditiesLiveMarketBoardRow,
  CommoditiesSignalsPayload,
} from "@/src/assets/commodities/types";
import { captureShadowTradePlans } from "@/src/application/outcomes/shadowTracker";
import { createId } from "@/src/lib/ids";
import { TelegramNotifier } from "@/src/lib/telegram";

type CommoditiesRuntimeState = {
  latestCards: CommoditySignalCard[];
  lastCycleAt: number | null;
  cycleRunning: boolean;
};

const globalForCommoditiesRuntime = globalThis as typeof globalThis & {
  __apexCommoditiesRuntime?: CommoditiesRuntimeState;
};

const runtimeState = globalForCommoditiesRuntime.__apexCommoditiesRuntime ??= {
  latestCards: [],
  lastCycleAt: null,
  cycleRunning: false,
};

function getProviderLabel(): string {
  if (runtimeState.lastCycleAt == null) {
    return "Provider Pending";
  }
  const summary = getCommodityProviderSummary();
  if (summary.status === "degraded_cached") {
    return "Cached Data";
  }
  return "Yahoo";
}

function formatFeedReason(): string {
  const summary = getCommodityProviderSummary();
  if (runtimeState.lastCycleAt == null) {
    return "cycle not run";
  }
  if (summary.status === "degraded_cached") {
    return "using cached yahoo commodity candles";
  }
  if (summary.status === "no_data") {
    return "yahoo commodity data unavailable";
  }
  return "data unavailable";
}

export async function triggerCommoditiesCycle(): Promise<{ cycleId: string; cardCount: number }> {
  if (!isAssetModuleEnabled("commodities")) {
    return {
      cycleId: "commodities_disabled",
      cardCount: runtimeState.latestCards.length,
    };
  }

  if (runtimeState.cycleRunning) {
    return {
      cycleId: "commodities_skipped_running",
      cardCount: runtimeState.latestCards.length,
    };
  }

  runtimeState.cycleRunning = true;
  const cycleId = createId("commoditycycle");
  try {
    await warmCommodityProviders().catch(error => {
      console.warn("[commodities-runtime] Provider warmup failed:", error);
    });
    runtimeState.latestCards = await runCommoditiesCycle(cycleId);
    runtimeState.lastCycleAt = Date.now();
    await persistSignalViewModels(runtimeState.latestCards, { logPrefix: "APEX COMMODITIES" });
    const telegramAlertsSent = await new TelegramNotifier().sendMarketSignalAlerts(runtimeState.latestCards, {
      assetLabel: "Commodities",
      messageType: "commodity_signal",
    });
    console.log(`[commodities-runtime] Telegram alerts sent: ${telegramAlertsSent}`);
    await captureShadowTradePlans({
      source: "commodity-runtime",
      assetClass: "commodity",
      cycleId,
      generatedAt: runtimeState.latestCards[0]?.generatedAt ?? runtimeState.lastCycleAt,
      cards: runtimeState.latestCards,
    }).catch(error => {
      console.error("[commodities-runtime] Shadow trade capture failed:", error);
    });
    return {
      cycleId,
      cardCount: runtimeState.latestCards.length,
    };
  } finally {
    runtimeState.cycleRunning = false;
  }
}

export function getLatestCommoditiesCards(): CommoditySignalCard[] {
  return [...runtimeState.latestCards];
}

function buildPlaceholderRow(symbol: CommoditySymbol): CommoditiesLiveMarketBoardRow {
  const category = getCommodityCategory(symbol);
  return {
    symbol,
    displayName: COMMODITY_DISPLAY_NAMES[symbol],
    category,
    livePrice: null,
    direction: "neutral",
    grade: null,
    status: "watchlist",
    noTradeReason: formatFeedReason(),
    marketStateLabels: [
      category === "PRECIOUS_METALS" ? "Precious Metals" : "Energy",
      getProviderLabel(),
    ],
    macroDirectionBias: "neutral",
    dataSource: null,
  };
}

function buildLiveMarketBoard(cards: CommoditySignalCard[]): CommoditiesLiveMarketBoardRow[] {
  const cardsBySymbol = new Map(cards.map(card => [card.marketSymbol, card]));
  return ALL_COMMODITY_SYMBOLS.map(symbol => {
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
      noTradeReason: card.noTradeReason,
      marketStateLabels: card.marketStateLabels,
      macroDirectionBias: card.macroDirectionBias,
      dataSource: card.dataSource,
    };
  });
}

export function getCommoditiesRuntimeStatus() {
  return {
    lastCycleAt: runtimeState.lastCycleAt,
    cardCount: runtimeState.latestCards.length,
    cycleRunning: runtimeState.cycleRunning,
  };
}

export function getCommoditiesSignalsPayload(): CommoditiesSignalsPayload {
  const enabled = isAssetModuleEnabled("commodities");
  const cards = enabled ? getLatestCommoditiesCards() : [];
  const provider = getCommodityProviderSummary();
  return {
    enabled,
    generatedAt: runtimeState.lastCycleAt ?? Date.now(),
    lastCycleAt: runtimeState.lastCycleAt,
    cycleRunning: runtimeState.cycleRunning,
    providerName: "Yahoo",
    providerStatus: provider.status,
    providerNotice: enabled ? provider.notice : "Commodities module disabled by asset controls.",
    cards,
    executable: cards.filter(card => card.displayCategory === "executable"),
    monitored: cards.filter(card => card.displayCategory === "monitored"),
    rejected: cards.filter(card => card.displayCategory === "rejected"),
    liveMarketBoard: buildLiveMarketBoard(cards),
  };
}
