import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { readPersistedMarketSymbol } from "@/src/assets/shared/persistedSignalViewModel";
import { SignalViewModelBuilder } from "@/src/domain/services/viewModelBuilder";
import { prisma } from "@/src/infrastructure/db/prisma";
import { expandMarketSymbolAliases } from "@/src/lib/marketSymbols";
import type { TraderPairRuntimeState } from "@/src/lib/traderContracts";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ForexSignalRow = {
  symbol: string;
  grade: string | null;
  status: "active" | "watchlist" | "blocked" | "pending" | "invalidated" | "expired";
  direction: "buy" | "sell" | "neutral" | null;
  confidence: number | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  reasoning: string | null;
  generatedAt: number | null;
};

type ForexSignalsPayload = {
  generatedAt: number;
  pairs: ForexSignalRow[];
};

const FX_PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "EURJPY",
  "AUDUSD",
  "NZDUSD",
  "USDCHF",
  "USDCAD",
] as const;

const METALS = [
  "XAUUSD",
  "XAGUSD",
] as const;

const PAIRS = [...FX_PAIRS, ...METALS] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function emptyRow(symbol: string): ForexSignalRow {
  return {
    symbol,
    grade: null,
    status: "pending",
    direction: null,
    confidence: null,
    entry: null,
    stopLoss: null,
    takeProfit: null,
    takeProfit2: null,
    takeProfit3: null,
    reasoning: null,
    generatedAt: null,
  };
}

function readPersistedAssetClass(uiSections: Prisma.JsonValue | null | undefined): string | null {
  const sections = asRecord(uiSections);
  const health = asRecord(sections.health);
  const model = asRecord(sections.model);

  const value = health.assetClass ?? model.assetClass ?? sections.assetClass;
  return typeof value === "string" ? value : null;
}

function mapStateDirection(state: TraderPairRuntimeState): ForexSignalRow["direction"] {
  if (state.card) {
    if (state.card.direction === "long") return "buy";
    if (state.card.direction === "short") return "sell";
    return "neutral";
  }

  if (state.liveMarket.bias === "bullish") return "buy";
  if (state.liveMarket.bias === "bearish") return "sell";
  return "neutral";
}

function stateToRow(state: TraderPairRuntimeState): ForexSignalRow {
  const card = state.card;
  const reasoning = card
    ? card.detailedReasoning.whyThisIsASetup
      || card.shortReasoning
      || card.noTradeExplanation
      || card.whyNotValid
      || state.marketReasoning.summary
    : state.marketReasoning.summary;

  return {
    symbol: state.symbol,
    grade: card?.grade ?? state.liveMarket.grade ?? null,
    status: card?.status ?? state.liveMarket.status ?? "pending",
    direction: mapStateDirection(state),
    confidence: card ? Math.round(card.confidence * 100) : null,
    entry: card?.entry ?? null,
    stopLoss: card?.sl ?? null,
    takeProfit: card?.tp1 ?? null,
    takeProfit2: card?.tp2 ?? null,
    takeProfit3: card?.tp3 ?? null,
    reasoning: reasoning ?? null,
    generatedAt: state.generatedAt,
  };
}

function isTraderPairRuntimeState(value: unknown): value is TraderPairRuntimeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<TraderPairRuntimeState>;
  return typeof candidate.symbol === "string"
    && typeof candidate.generatedAt === "number"
    && typeof candidate.cycleId === "string"
    && candidate.liveMarket != null
    && candidate.marketReasoning != null
    && candidate.keyAreas != null
    && candidate.diagnostics != null;
}

async function loadLatestRuntimeStates(symbols: readonly string[]): Promise<TraderPairRuntimeState[]> {
  const rows = await prisma.systemEvent.findMany({
    where: {
      type: "pair_runtime_state_updated",
    },
    orderBy: {
      ts: "desc",
    },
    take: Math.max(200, symbols.length * 20),
    select: {
      payload: true,
    },
  });

  const latest = new Map<string, TraderPairRuntimeState>();
  for (const row of rows) {
    const payload = row.payload;
    if (!isTraderPairRuntimeState(payload)) {
      continue;
    }
    if (!symbols.includes(payload.symbol)) {
      continue;
    }

    const current = latest.get(payload.symbol);
    if (!current || payload.generatedAt >= current.generatedAt) {
      latest.set(payload.symbol, payload);
    }
  }

  return [...latest.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export async function GET() {
  const latest = new Map<string, ForexSignalRow>();
  const symbols = [...PAIRS];
  console.log("[FX SIGNALS API] Querying symbols:", symbols);

  try {
    const runtimeStates = await loadLatestRuntimeStates([...PAIRS]);
    for (const state of runtimeStates) {
      if (!PAIRS.includes(state.symbol as (typeof PAIRS)[number])) {
        continue;
      }
      latest.set(state.symbol, stateToRow(state));
    }
    console.log("[FX SIGNALS API] Runtime states:", runtimeStates.map(state => state.symbol));
  } catch (error) {
    console.error("[FX SIGNALS API] Failed to read runtime states:", error);
  }

  const missingPairs = PAIRS.filter(symbol => !latest.has(symbol));
  if (missingPairs.length > 0) {
    const querySymbols = expandMarketSymbolAliases(missingPairs);

    const rows = await prisma.$queryRaw<Array<{
      view_id: string;
      entity_ref: string;
      display_type: string;
      headline: string;
      summary: string;
      reason_labels: string[];
      confidence_label: string | null;
      ui_sections: Prisma.JsonValue;
      commentary: Prisma.JsonValue | null;
      ui_version: string;
      generated_at: Date;
    }>>(Prisma.sql`
      SELECT
        view_id,
        entity_ref,
        display_type,
        headline,
        summary,
        reason_labels,
        confidence_label,
        ui_sections,
        commentary,
        ui_version,
        generated_at
      FROM apex."SignalViewModel"
      WHERE COALESCE(
        ui_sections->>'marketSymbol',
        ui_sections->'model'->>'marketSymbol',
        ui_sections->'model'->>'symbol'
      ) IN (${Prisma.join(querySymbols.map(symbol => Prisma.sql`${symbol}`))})
      ORDER BY generated_at DESC
      LIMIT 128
    `);

    for (const row of rows) {
      try {
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
        if (!missingPairs.includes(marketSymbol as (typeof PAIRS)[number])) {
          continue;
        }

        const assetClass = readPersistedAssetClass(row.ui_sections);
        const isMajorFxPair = FX_PAIRS.includes(marketSymbol as (typeof FX_PAIRS)[number]);
        const isMetal = METALS.includes(marketSymbol as (typeof METALS)[number]);
        if (isMajorFxPair && assetClass != null && assetClass !== "fx") {
          continue;
        }
        if (isMetal && assetClass != null && assetClass !== "fx" && assetClass !== "commodity") {
          continue;
        }
        if (latest.has(marketSymbol)) {
          continue;
        }

        latest.set(marketSymbol, {
          symbol: marketSymbol,
          grade: model.grade ?? null,
          status: model.status ?? "pending",
          direction: model.direction ?? null,
          confidence: Number.isFinite(model.confidence) ? Math.round(model.confidence * 100) : null,
          entry: model.entry ?? null,
          stopLoss: model.sl ?? null,
          takeProfit: model.tp1 ?? null,
          takeProfit2: model.tp2 ?? null,
          takeProfit3: model.tp3 ?? null,
          reasoning: model.detailedReasoning || model.summary || model.shortReasoning || null,
          generatedAt: model.generatedAt ?? row.generated_at.getTime(),
        });
      } catch (error) {
        console.error("[FX SIGNALS API] Failed to hydrate row:", row.entity_ref, error);
      }
    }
  }

  console.log("[FX SIGNALS API] Found:", [...latest.keys()]);

  const payload: ForexSignalsPayload = {
    generatedAt: Date.now(),
    pairs: PAIRS.map(symbol => latest.get(symbol) ?? emptyRow(symbol)),
  };

  return NextResponse.json(payload);
}
