import {
  ALL_STOCK_SYMBOLS,
  STOCK_DISPLAY_NAMES,
  getStockCategory,
  isStockMarketOpen,
  type StockSymbol,
} from "@/src/assets/stocks/config/stocksScope";
import { isAssetModuleEnabled } from "@/src/config/assetActivation";
import { getStocksProviderSummary, runStocksCycle, runStocksProviderWarmup } from "@/src/assets/stocks/engine/StocksEngine";
import { persistSignalViewModels } from "@/src/assets/shared/persistedSignalViewModel";
import { captureShadowTradePlans } from "@/src/application/outcomes/shadowTracker";
import type { StockSignalCard, StocksLiveMarketBoardRow, StocksSignalsPayload } from "@/src/assets/stocks/types";
import { createId } from "@/src/lib/ids";
import { TelegramNotifier } from "@/src/lib/telegram";

type StocksRuntimeState = {
  latestCards: StockSignalCard[];
  lastCycleAt: number | null;
  cycleRunning: boolean;
};

const globalForStocksRuntime = globalThis as typeof globalThis & {
  __apexStocksRuntime?: StocksRuntimeState;
};

const runtimeState = globalForStocksRuntime.__apexStocksRuntime ??= {
  latestCards: [],
  lastCycleAt: null,
  cycleRunning: false,
};

export async function triggerStocksCycle(): Promise<{ cycleId: string; cardCount: number }> {
  if (!isAssetModuleEnabled("stocks")) {
    return {
      cycleId: "stocks_disabled",
      cardCount: runtimeState.latestCards.length,
    };
  }

  if (runtimeState.cycleRunning) {
    return {
      cycleId: "stocks_skipped_running",
      cardCount: runtimeState.latestCards.length,
    };
  }

  runtimeState.cycleRunning = true;
  const cycleId = createId("stockcycle");
  try {
    const warmup = await runStocksProviderWarmup();
    if (!warmup.ok) {
      runtimeState.latestCards = [];
      runtimeState.lastCycleAt = Date.now();
      return {
        cycleId,
        cardCount: 0,
      };
    }

    runtimeState.latestCards = await runStocksCycle(cycleId);
    runtimeState.lastCycleAt = Date.now();
    await persistSignalViewModels(runtimeState.latestCards, { logPrefix: "APEX STOCKS" });
    const telegramAlertsSent = await new TelegramNotifier().sendMarketSignalAlerts(runtimeState.latestCards, {
      assetLabel: "Stocks",
      messageType: "stock_signal",
    });
    console.log(`[stocks-runtime] Telegram alerts sent: ${telegramAlertsSent}`);
    await captureShadowTradePlans({
      source: "stock-runtime",
      assetClass: "stock",
      cycleId,
      generatedAt: runtimeState.latestCards[0]?.generatedAt ?? runtimeState.lastCycleAt,
      cards: runtimeState.latestCards,
    }).catch(error => {
      console.error("[stocks-runtime] Shadow trade capture failed:", error);
    });
    return {
      cycleId,
      cardCount: runtimeState.latestCards.length,
    };
  } finally {
    runtimeState.cycleRunning = false;
  }
}

export function getLatestStocksCards(): StockSignalCard[] {
  return [...runtimeState.latestCards];
}

function buildPlaceholderRow(symbol: StockSymbol): StocksLiveMarketBoardRow {
  const category = getStockCategory(symbol);
  return {
    symbol,
    displayName: STOCK_DISPLAY_NAMES[symbol],
    category,
    livePrice: null,
    direction: "neutral",
    grade: null,
    status: "watchlist",
    marketOpen: isStockMarketOpen(category),
    noTradeReason: runtimeState.lastCycleAt == null ? "cycle not run" : getStocksProviderSummary().notice ?? "data unavailable",
    marketStateLabels: [isStockMarketOpen(category) ? "Market Open" : "Market Closed", category.replaceAll("_", " "), "STOCK MODULE"],
    trendDirection: "neutral",
    daysUntilEarnings: null,
    dataSource: null,
  };
}

function buildLiveMarketBoard(cards: StockSignalCard[]): StocksLiveMarketBoardRow[] {
  const cardsBySymbol = new Map(cards.map(card => [card.marketSymbol, card]));
  return ALL_STOCK_SYMBOLS.map(symbol => {
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
      trendDirection: card.trendDirection,
      daysUntilEarnings: card.daysUntilEarnings,
      dataSource: card.dataSource,
    };
  });
}

export function getStocksRuntimeStatus() {
  return {
    lastCycleAt: runtimeState.lastCycleAt,
    cardCount: runtimeState.latestCards.length,
    cycleRunning: runtimeState.cycleRunning,
  };
}

export function getStocksSignalsPayload(): StocksSignalsPayload {
  const enabled = isAssetModuleEnabled("stocks");
  const cards = enabled ? getLatestStocksCards() : [];
  const provider = getStocksProviderSummary();
  return {
    enabled,
    generatedAt: runtimeState.lastCycleAt ?? Date.now(),
    lastCycleAt: runtimeState.lastCycleAt,
    cycleRunning: runtimeState.cycleRunning,
    providerName: "Yahoo",
    providerStatus: provider.status,
    providerNotice: enabled ? provider.notice : "Stocks module disabled by asset controls.",
    cards,
    executable: cards.filter(card => card.displayCategory === "executable"),
    monitored: cards.filter(card => card.displayCategory === "monitored"),
    rejected: cards.filter(card => card.displayCategory === "rejected"),
    liveMarketBoard: buildLiveMarketBoard(cards),
  };
}
