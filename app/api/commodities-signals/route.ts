import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  ALL_COMMODITY_SYMBOLS,
  COMMODITY_DISPLAY_NAMES,
  getCommodityCategory,
  type CommoditySymbol,
} from "@/src/assets/commodities/config/commoditiesScope";
import type {
  CommoditySignalCard,
  CommoditiesLiveMarketBoardRow,
  CommoditiesSignalsPayload,
} from "@/src/assets/commodities/types";
import { getCommoditiesSignalsPayload } from "@/src/assets/commodities/engine/commoditiesRuntime";
import { readPersistedMarketSymbol } from "@/src/assets/shared/persistedSignalViewModel";
import { SignalViewModelBuilder } from "@/src/domain/services/viewModelBuilder";
import { prisma } from "@/src/infrastructure/db/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const COMMODITY_ALIASES: Array<{ symbol: CommoditySymbol; aliases: readonly string[] }> = [
  { symbol: "XAUUSD", aliases: ["XAUUSD"] },
  { symbol: "XAGUSD", aliases: ["XAGUSD"] },
  { symbol: "WTICOUSD", aliases: ["WTICOUSD", "CL=F"] },
  { symbol: "BCOUSD", aliases: ["BCOUSD", "BZ=F"] },
  { symbol: "NATGASUSD", aliases: ["NATGASUSD", "NG=F"] },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readCommodityDataSource(value: unknown): CommoditySignalCard["dataSource"] {
  return value === "yahoo" || value === "cached_yahoo" || value === "none"
    ? value
    : "none";
}

function readCommodityMacroBias(value: unknown): CommoditySignalCard["macroDirectionBias"] {
  return value === "bullish" || value === "bearish" || value === "neutral"
    ? value
    : "neutral";
}

function buildCommodityLiveMarketBoard(cards: CommoditySignalCard[]): CommoditiesLiveMarketBoardRow[] {
  const cardsBySymbol = new Map(cards.map(card => [card.marketSymbol, card]));
  return ALL_COMMODITY_SYMBOLS.map(symbol => {
    const card = cardsBySymbol.get(symbol);
    if (card) {
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
    }

    const category = getCommodityCategory(symbol);
    return {
      symbol,
      displayName: COMMODITY_DISPLAY_NAMES[symbol],
      category,
      livePrice: null,
      direction: "neutral",
      grade: null,
      status: "watchlist",
      noTradeReason: "Awaiting the next commodities cycle.",
      marketStateLabels: [
        category === "PRECIOUS_METALS" ? "Precious Metals" : "Energy",
        "Yahoo",
      ],
      macroDirectionBias: "neutral",
      dataSource: null,
    };
  });
}

async function buildPersistedCommodityPayload(): Promise<CommoditiesSignalsPayload> {
  const rows = await prisma.signalViewModel.findMany({
    orderBy: {
      generated_at: "desc",
    },
    take: 120,
  });

  const latest = new Map<CommoditySymbol, CommoditySignalCard>();

  for (const row of rows) {
    const model = SignalViewModelBuilder.hydratePersistedViewModel({
      viewId: row.view_id,
      entityRef: row.entity_ref,
      displayType: row.display_type as "executable" | "monitored" | "rejected",
      headline: row.headline,
      summary: row.summary,
      reasonLabels: [...row.reason_labels],
      confidenceLabel: row.confidence_label,
      uiSections: asRecord(row.ui_sections),
      commentary: asRecord(row.commentary),
      uiVersion: row.ui_version,
      generatedAt: row.generated_at.getTime(),
    });

    const marketSymbol = readPersistedMarketSymbol(row.ui_sections) ?? model.symbol;
    const commodity = COMMODITY_ALIASES.find(entry => entry.aliases.includes(marketSymbol));
    if (!commodity || latest.has(commodity.symbol)) {
      continue;
    }

    const sections = asRecord(model.ui_sections);
    const health = asRecord(sections.health);
    const displayName = typeof sections.displayName === "string"
      ? sections.displayName
      : COMMODITY_DISPLAY_NAMES[commodity.symbol];
    const dataSource = readCommodityDataSource(
      sections.dataSource
      ?? sections.source
      ?? health.candleSource
      ?? health.priceSource
      ?? model.candleSource
      ?? model.priceSource,
    );
    const macroDirectionBias = readCommodityMacroBias(
      sections.macroDirectionBias
      ?? sections.bias,
    );
    const macroNote = typeof sections.macroNote === "string"
      ? sections.macroNote
      : model.liquiditySummary || model.summary;

    latest.set(commodity.symbol, {
      ...model,
      assetClass: "commodity",
      marketSymbol: commodity.symbol,
      displayName,
      category: getCommodityCategory(commodity.symbol),
      macroNote,
      macroDirectionBias,
      dataSource,
    });
  }

  const cards = ALL_COMMODITY_SYMBOLS
    .map(symbol => latest.get(symbol))
    .filter((card): card is CommoditySignalCard => card != null);
  const lastCycleAt = cards.reduce<number | null>((latestTimestamp, card) => {
    return latestTimestamp == null || card.generatedAt > latestTimestamp
      ? card.generatedAt
      : latestTimestamp;
  }, null);
  const hasCachedRows = cards.some(card => card.dataSource === "cached_yahoo");
  const providerStatus = cards.length === 0
    ? "no_data"
    : hasCachedRows
      ? "degraded_cached"
      : "healthy";
  const providerNotice = cards.length === 0
    ? "No persisted commodities cycle is available yet."
    : hasCachedRows
      ? "Commodities are loading from cached Yahoo data."
      : "Commodities are loading from persisted Yahoo cycle output.";

  return {
    enabled: true,
    generatedAt: Date.now(),
    lastCycleAt,
    cycleRunning: false,
    providerName: "Yahoo",
    providerStatus,
    providerNotice,
    cards,
    executable: cards.filter(card => card.displayCategory === "executable"),
    monitored: cards.filter(card => card.displayCategory === "monitored"),
    rejected: cards.filter(card => card.displayCategory === "rejected"),
    liveMarketBoard: buildCommodityLiveMarketBoard(cards),
  };
}

export async function GET() {
  try {
    const payload = getCommoditiesSignalsPayload();
    if (payload.cards.length > 0) {
      return NextResponse.json(payload);
    }

    return NextResponse.json(await buildPersistedCommodityPayload());
  } catch (error) {
    console.error("[api/commodities-signals] Failed to read commodities payload:", error);
    return NextResponse.json({
      enabled: true,
      generatedAt: Date.now(),
      lastCycleAt: null,
      cycleRunning: false,
      providerName: "Yahoo",
      providerStatus: "no_data",
      providerNotice: "Yahoo Finance commodity data is unavailable.",
      cards: [],
      executable: [],
      monitored: [],
      rejected: [],
      liveMarketBoard: [],
    });
  }
}
