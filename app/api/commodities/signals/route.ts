import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { readPersistedMarketSymbol } from "@/src/assets/shared/persistedSignalViewModel";
import { SignalViewModelBuilder } from "@/src/domain/services/viewModelBuilder";
import { prisma } from "@/src/infrastructure/db/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CommoditySignalRow = {
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

type CommoditySignalsPayload = {
  generatedAt: number;
  assets: CommoditySignalRow[];
};

const COMMODITIES = [
  { symbol: "XAUUSD", aliases: ["XAUUSD"] },
  { symbol: "XAGUSD", aliases: ["XAGUSD"] },
  { symbol: "WTICOUSD", aliases: ["WTICOUSD", "CL=F"] },
  { symbol: "BCOUSD", aliases: ["BCOUSD", "BZ=F"] },
  { symbol: "NATGASUSD", aliases: ["NATGASUSD", "NG=F"] },
] as const;

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function emptyRow(symbol: string): CommoditySignalRow {
  return {
    symbol,
    grade: "F",
    status: "watchlist",
    direction: "neutral",
    confidence: 0,
    entry: null,
    stopLoss: null,
    takeProfit: null,
    takeProfit2: null,
    takeProfit3: null,
    reasoning: "Signal unavailable for the latest commodities cycle.",
    generatedAt: null,
  };
}

export async function GET() {
  const rows = await prisma.signalViewModel.findMany({
    orderBy: {
      generated_at: "desc",
    },
    take: 300,
  });

  const latest = new Map<string, CommoditySignalRow>();

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
    const commodity = COMMODITIES.find(entry => (entry.aliases as readonly string[]).includes(marketSymbol));
    if (!commodity || latest.has(commodity.symbol)) {
      continue;
    }

    latest.set(commodity.symbol, {
      symbol: commodity.symbol,
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
  }

  const payload: CommoditySignalsPayload = {
    generatedAt: Date.now(),
    assets: COMMODITIES.map(commodity => latest.get(commodity.symbol) ?? emptyRow(commodity.symbol)),
  };

  return NextResponse.json(payload);
}
