import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { readPersistedMarketSymbol } from "@/src/assets/shared/persistedSignalViewModel";
import { SignalViewModelBuilder } from "@/src/domain/services/viewModelBuilder";
import { prisma } from "@/src/infrastructure/db/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StockSignalRow = {
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

type StockSignalsPayload = {
  generatedAt: number;
  assets: StockSignalRow[];
};

const STOCKS = [
  { symbol: "AAPL", aliases: ["AAPL"] },
  { symbol: "MSFT", aliases: ["MSFT"] },
  { symbol: "NVDA", aliases: ["NVDA"] },
  { symbol: "GOOGL", aliases: ["GOOGL"] },
  { symbol: "META", aliases: ["META"] },
  { symbol: "AMZN", aliases: ["AMZN"] },
  { symbol: "TSLA", aliases: ["TSLA"] },
  { symbol: "JPM", aliases: ["JPM"] },
  { symbol: "GS", aliases: ["GS"] },
  { symbol: "BAC", aliases: ["BAC"] },
  { symbol: "XOM", aliases: ["XOM"] },
  { symbol: "CVX", aliases: ["CVX"] },
] as const;

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function emptyRow(symbol: string): StockSignalRow {
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
    reasoning: "Signal unavailable for the latest stocks cycle.",
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

  const latest = new Map<string, StockSignalRow>();

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
    const stock = STOCKS.find(entry => (entry.aliases as readonly string[]).includes(marketSymbol));
    if (!stock || latest.has(stock.symbol)) {
      continue;
    }

    latest.set(stock.symbol, {
      symbol: stock.symbol,
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

  const payload: StockSignalsPayload = {
    generatedAt: Date.now(),
    assets: STOCKS.map(stock => latest.get(stock.symbol) ?? emptyRow(stock.symbol)),
  };

  return NextResponse.json(payload);
}
