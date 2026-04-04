import { NextResponse } from "next/server";

import { CRYPTO_ACTIVE_SYMBOLS } from "@/src/crypto/config/cryptoScope";
import { getCryptoSignalsPayload } from "@/src/crypto/engine/cryptoRuntime";
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

type CryptoAssetDefinition = {
  symbol: string;
  aliases: string[];
};

const CRYPTO_ASSETS: CryptoAssetDefinition[] = [
  { symbol: "BTCUSDT", aliases: ["BTCUSDT", "BTC/USD"] },
  { symbol: "ETHUSDT", aliases: ["ETHUSDT", "ETH/USD"] },
  { symbol: "SOLUSDT", aliases: ["SOLUSDT", "SOL/USD"] },
  { symbol: "BNBUSDT", aliases: ["BNBUSDT", "BNB/USD"] },
  { symbol: "XRPUSDT", aliases: ["XRPUSDT", "XRP/USD"] },
  { symbol: "DOGEUSDT", aliases: ["DOGEUSDT", "DOGE/USD"] },
  { symbol: "ADAUSDT", aliases: ["ADAUSDT", "ADA/USD"] },
  { symbol: "AVAXUSDT", aliases: ["AVAXUSDT", "AVAX/USD"] },
] as const;

const ACTIVE_CRYPTO_SYMBOLS = new Set<string>([...CRYPTO_ACTIVE_SYMBOLS]);
const STALE_PERSISTED_FALLBACK_MS = 2 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function emptyRow(symbol: string, reasoning: string): CryptoSignalRow {
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
    reasoning,
    generatedAt: null,
  };
}

function normalizeConfidence(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value <= 1 ? value * 100 : value);
}

function normalizeStatus(value: unknown): CryptoSignalRow["status"] {
  return typeof value === "string"
    && ["active", "watchlist", "blocked", "pending", "invalidated", "expired"].includes(value)
    ? value as CryptoSignalRow["status"]
    : "pending";
}

function readPersistedAssetClass(uiSections: unknown): string | null {
  const sections = asRecord(uiSections);
  const health = asRecord(sections.health);
  const model = readPersistedSignalModel(sections);

  if (typeof model.assetClass === "string") {
    return model.assetClass;
  }
  if (typeof health.assetClass === "string") {
    return health.assetClass;
  }
  if (typeof sections.assetClass === "string") {
    return sections.assetClass;
  }
  return null;
}

function mapRuntimeCardToRow(card: ReturnType<typeof getCryptoSignalsPayload>["cards"][number]): CryptoSignalRow {
  const generatedAt = typeof card.generatedAt === "number"
    ? card.generatedAt
    : typeof card.generated_at === "number"
      ? card.generated_at
      : null;

  return {
    symbol: card.marketSymbol,
    grade: card.grade ?? null,
    status: card.status,
    direction: card.direction,
    confidence: normalizeConfidence(card.confidence),
    entry: card.entry,
    stopLoss: card.sl,
    takeProfit: card.tp1,
    takeProfit2: card.tp2 ?? null,
    takeProfit3: card.tp3 ?? null,
    reasoning: card.detailedReasoning || card.summary || card.noTradeExplanation || card.whyNow || null,
    generatedAt,
  };
}

function mapPersistedRowToSignal(row: {
  headline: string;
  summary: string;
  commentary: unknown;
  ui_sections: unknown;
  generated_at: Date;
}): CryptoSignalRow | null {
  const persisted = readPersistedSignalModel(row.ui_sections);
  const commentary = row.commentary && typeof row.commentary === "object" && !Array.isArray(row.commentary)
    ? row.commentary as Record<string, unknown>
    : {};
  const direction = typeof persisted.direction === "string"
    && (persisted.direction === "buy" || persisted.direction === "sell" || persisted.direction === "neutral")
    ? persisted.direction
    : null;
  const grade = typeof persisted.grade === "string" ? persisted.grade : null;

  if (!grade || grade === "F") {
    return null;
  }

  return {
    symbol: typeof persisted.marketSymbol === "string" ? persisted.marketSymbol : typeof persisted.symbol === "string" ? persisted.symbol : "",
    grade,
    status: normalizeStatus(persisted.status),
    direction,
    confidence: normalizeConfidence(typeof persisted.confidence === "number" ? persisted.confidence : null),
    entry: typeof persisted.entry === "number" && Number.isFinite(persisted.entry) ? persisted.entry : null,
    stopLoss: typeof persisted.sl === "number" && Number.isFinite(persisted.sl) ? persisted.sl : null,
    takeProfit: typeof persisted.tp1 === "number" && Number.isFinite(persisted.tp1) ? persisted.tp1 : null,
    takeProfit2: typeof persisted.tp2 === "number" && Number.isFinite(persisted.tp2) ? persisted.tp2 : null,
    takeProfit3: typeof persisted.tp3 === "number" && Number.isFinite(persisted.tp3) ? persisted.tp3 : null,
    reasoning: typeof commentary.detailed_reasoning === "string"
      ? commentary.detailed_reasoning
      : typeof commentary.short_reasoning === "string"
        ? commentary.short_reasoning
        : row.summary || row.headline || null,
    generatedAt: row.generated_at.getTime(),
  };
}

async function readPersistedCryptoFallbacks(missingSymbols: string[]): Promise<Map<string, CryptoSignalRow>> {
  if (missingSymbols.length === 0) {
    return new Map();
  }

  const notOlderThan = new Date(Date.now() - STALE_PERSISTED_FALLBACK_MS);
  const rows = await prisma.signalViewModel.findMany({
    where: {
      generated_at: {
        gte: notOlderThan,
      },
    },
    orderBy: {
      generated_at: "desc",
    },
    take: 300,
  });

  const latest = new Map<string, CryptoSignalRow>();
  for (const row of rows) {
    const marketSymbol = readPersistedMarketSymbol(row.ui_sections);
    const assetClass = readPersistedAssetClass(row.ui_sections);
    if (assetClass !== "crypto" || !marketSymbol || latest.has(marketSymbol) || !missingSymbols.includes(marketSymbol)) {
      continue;
    }

    const mapped = mapPersistedRowToSignal(row);
    if (!mapped) {
      continue;
    }

    latest.set(marketSymbol, {
      ...mapped,
      symbol: marketSymbol,
    });
  }

  return latest;
}

export async function GET() {
  const livePayload = getCryptoSignalsPayload();
  const liveCards = new Map<string, CryptoSignalRow>(
    livePayload.cards.map(card => [card.marketSymbol, mapRuntimeCardToRow(card)]),
  );
  const missingActiveSymbols = CRYPTO_ACTIVE_SYMBOLS.filter(symbol => !liveCards.has(symbol));
  const persistedFallbacks = await readPersistedCryptoFallbacks(missingActiveSymbols);

  const assets = CRYPTO_ASSETS.map(asset => {
    const live = liveCards.get(asset.symbol);
    if (live) {
      return live;
    }

    const persisted = persistedFallbacks.get(asset.symbol);
    if (persisted) {
      return persisted;
    }

    return ACTIVE_CRYPTO_SYMBOLS.has(asset.symbol)
      ? emptyRow(asset.symbol, livePayload.cycleRunning ? "Crypto runtime cycle is running." : "Crypto runtime is warming up.")
      : emptyRow(asset.symbol, "This asset is not in the active crypto runtime.");
  });

  return NextResponse.json({
    generatedAt: livePayload.lastCycleAt ?? livePayload.generatedAt ?? Date.now(),
    assets,
  } satisfies CryptoSignalsPayload);
}
