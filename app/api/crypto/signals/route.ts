import { NextResponse } from "next/server";

import { readPersistedMarketSymbol, readPersistedSignalModel } from "@/src/assets/shared/persistedSignalViewModel";
import { prisma } from "@/src/infrastructure/db/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CryptoSignalRow = {
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

type CryptoSignalsPayload = {
  generatedAt: number;
  assets: CryptoSignalRow[];
};

const CRYPTO_ASSETS = [
  { symbol: "BTCUSDT", aliases: ["BTCUSDT", "BTC/USD", "BTCUSDT"] },
  { symbol: "ETHUSDT", aliases: ["ETHUSDT", "ETH/USD", "ETHUSDT"] },
  { symbol: "SOLUSDT", aliases: ["SOLUSDT", "SOL/USD", "SOLUSDT"] },
  { symbol: "BNBUSDT", aliases: ["BNBUSDT", "BNB/USD", "BNBUSDT"] },
  { symbol: "XRPUSDT", aliases: ["XRPUSDT", "XRP/USD", "XRPUSDT"] },
  { symbol: "DOGEUSDT", aliases: ["DOGEUSDT", "DOGE/USD", "DOGEUSDT"] },
  { symbol: "ADAUSDT", aliases: ["ADAUSDT", "ADA/USD", "ADAUSDT"] },
  { symbol: "AVAXUSDT", aliases: ["AVAXUSDT", "AVAX/USD", "AVAXUSDT"] },
] as const;

function emptyRow(symbol: string): CryptoSignalRow {
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
    reasoning: "Signal unavailable for the latest crypto cycle.",
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

  const latest = new Map<string, CryptoSignalRow>();

  for (const row of rows) {
    const marketSymbol = readPersistedMarketSymbol(row.ui_sections);
    const displaySymbol = row.headline;
    const summary = row.summary;
    const commentary = row.commentary && typeof row.commentary === "object" && !Array.isArray(row.commentary)
      ? row.commentary as Record<string, unknown>
      : {};
    const signalReasoning = typeof commentary.detailed_reasoning === "string"
      ? commentary.detailed_reasoning
      : typeof commentary.short_reasoning === "string"
        ? commentary.short_reasoning
        : summary;

    const persisted = readPersistedSignalModel(row.ui_sections);
    const matchedAsset = CRYPTO_ASSETS.find(asset => {
      if (marketSymbol && (asset.aliases as readonly string[]).includes(marketSymbol)) {
        return true;
      }
      return typeof persisted.symbol === "string" && (asset.aliases as readonly string[]).includes(persisted.symbol);
    });

    if (!matchedAsset || latest.has(matchedAsset.symbol)) {
      continue;
    }

    const direction = typeof persisted.direction === "string"
      && (persisted.direction === "buy" || persisted.direction === "sell" || persisted.direction === "neutral")
      ? persisted.direction
      : null;

    latest.set(matchedAsset.symbol, {
      symbol: matchedAsset.symbol,
      grade: typeof persisted.grade === "string" ? persisted.grade : null,
      status: typeof persisted.status === "string"
        && ["active", "watchlist", "blocked", "pending", "invalidated", "expired"].includes(persisted.status)
        ? persisted.status as CryptoSignalRow["status"]
        : "pending",
      direction,
      confidence: typeof persisted.confidence === "number" && Number.isFinite(persisted.confidence)
        ? Math.round(persisted.confidence * 100)
        : null,
      entry: typeof persisted.entry === "number" && Number.isFinite(persisted.entry) ? persisted.entry : null,
      stopLoss: typeof persisted.sl === "number" && Number.isFinite(persisted.sl) ? persisted.sl : null,
      takeProfit: typeof persisted.tp1 === "number" && Number.isFinite(persisted.tp1) ? persisted.tp1 : null,
      takeProfit2: typeof persisted.tp2 === "number" && Number.isFinite(persisted.tp2) ? persisted.tp2 : null,
      takeProfit3: typeof persisted.tp3 === "number" && Number.isFinite(persisted.tp3) ? persisted.tp3 : null,
      reasoning: signalReasoning || (typeof displaySymbol === "string" ? displaySymbol : null),
      generatedAt: row.generated_at.getTime(),
    });
  }

  const payload: CryptoSignalsPayload = {
    generatedAt: Date.now(),
    assets: CRYPTO_ASSETS.map(asset => latest.get(asset.symbol) ?? emptyRow(asset.symbol)),
  };

  return NextResponse.json(payload);
}
