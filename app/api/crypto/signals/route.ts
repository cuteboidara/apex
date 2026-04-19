import { NextResponse } from "next/server";

import { triggerCryptoCycle } from "@/src/crypto/engine/cryptoRuntime";
import { getCryptoSignalsPayload } from "@/src/crypto/engine/cryptoRuntime";
import { selectTradableAssets } from "@/src/crypto/engine/CryptoEngine";
import type { CryptoNewsItem, CryptoSelectedAsset } from "@/src/crypto/types";
import { readPersistedMarketSymbol, readPersistedSignalModel } from "@/src/assets/shared/persistedSignalViewModel";
import { prisma } from "@/src/infrastructure/db/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRYPTO_BOOTSTRAP_TIMEOUT_MS = 25_000;

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
  news: CryptoNewsItem[];
};

type CryptoSignalsPayload = {
  generatedAt: number;
  selectionGeneratedAt: number | null;
  selectionProvider: string | null;
  selectedAssets: CryptoSelectedAsset[];
  assets: CryptoSignalRow[];
};

const STALE_PERSISTED_FALLBACK_MS = 2 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function emptyRow(asset: CryptoSelectedAsset, reasoning: string): CryptoSignalRow {
  return {
    symbol: asset.symbol,
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
    news: [],
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

function normalizeNews(value: unknown): CryptoNewsItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => {
      const record = asRecord(item);
      const headline = typeof record.headline === "string" ? record.headline : null;
      const source = typeof record.source === "string" ? record.source : null;
      const url = typeof record.url === "string" ? record.url : null;
      const sentiment = typeof record.sentiment === "string"
        && ["bullish", "bearish", "neutral"].includes(record.sentiment)
        ? record.sentiment as CryptoNewsItem["sentiment"]
        : "neutral";
      const publishedAt = typeof record.publishedAt === "string" ? record.publishedAt : null;

      if (!headline || !source || !url || !publishedAt) {
        return null;
      }

      return {
        headline,
        source,
        url,
        sentiment,
        publishedAt,
      } satisfies CryptoNewsItem;
    })
    .filter((item): item is CryptoNewsItem => item != null)
    .slice(0, 5);
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
    news: card.news ?? [],
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
    symbol: typeof persisted.marketSymbol === "string"
      ? persisted.marketSymbol
      : typeof persisted.symbol === "string"
        ? persisted.symbol
        : "",
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
    news: normalizeNews(persisted.news),
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
    take: 400,
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

async function buildCryptoSignalPayload() {
  const livePayload = getCryptoSignalsPayload();
  const selection = livePayload.selectedAssets.length > 0
    ? {
      generatedAt: livePayload.selectionGeneratedAt ?? livePayload.generatedAt,
      provider: livePayload.selectionProvider ?? "runtime",
      assets: livePayload.selectedAssets,
    }
    : await selectTradableAssets();

  const liveCards = new Map<string, CryptoSignalRow>(
    livePayload.cards.map(card => [card.marketSymbol, mapRuntimeCardToRow(card)]),
  );
  const missingSymbols = selection.assets.map(asset => asset.symbol).filter(symbol => !liveCards.has(symbol));
  const persistedFallbacks = await readPersistedCryptoFallbacks(missingSymbols);

  const assets = selection.assets.map(asset => {
    const live = liveCards.get(asset.symbol);
    if (live) {
      return live;
    }

    const persisted = persistedFallbacks.get(asset.symbol);
    if (persisted) {
      return persisted;
    }

    return emptyRow(
      asset,
      livePayload.cycleRunning
        ? "Crypto runtime cycle is running."
        : livePayload.lastCycleAt == null
          ? "Crypto cycle has not completed yet."
          : "No signal available for the latest crypto selection.",
    );
  });

  return {
    livePayload,
    selection,
    assets,
  };
}

async function maybeBootstrapCryptoRuntime(): Promise<void> {
  const payload = getCryptoSignalsPayload();
  if (payload.lastCycleAt != null || payload.cycleRunning) {
    return;
  }

  console.log("[api/crypto/signals] Bootstrapping empty crypto runtime.");
  await Promise.race([
    triggerCryptoCycle().catch(error => {
      console.error("[api/crypto/signals] Crypto bootstrap failed:", error);
    }),
    new Promise(resolve => setTimeout(resolve, CRYPTO_BOOTSTRAP_TIMEOUT_MS)),
  ]);
}

export async function GET() {
  let state = await buildCryptoSignalPayload();
  const allPending = state.assets.length > 0 && state.assets.every(asset => asset.status === "pending");

  if (allPending && state.livePayload.lastCycleAt == null && !state.livePayload.cycleRunning) {
    await maybeBootstrapCryptoRuntime();
    state = await buildCryptoSignalPayload();
  }

  return NextResponse.json({
    generatedAt: state.livePayload.lastCycleAt ?? state.livePayload.generatedAt ?? Date.now(),
    selectionGeneratedAt: state.selection.generatedAt,
    selectionProvider: state.selection.provider,
    selectedAssets: state.selection.assets,
    assets: state.assets,
  } satisfies CryptoSignalsPayload);
}
