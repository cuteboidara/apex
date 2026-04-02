import { ENGINE_VERSION, FEATURE_VERSION, PROMPT_VERSION } from "@/lib/runConfig";
import { ensureTradePlansForRun } from "@/lib/tradePlanPersistence";
import { prisma } from "@/lib/prisma";
import type { SignalAssetClass } from "@/src/domain/models/signalHealth";
import { createId } from "@/src/lib/ids";
import {
  mapProviderStatusToMarketStatus,
  mapProviderStatusToSignalHealth,
  resolveOutcomeDataQuality,
} from "@/src/assets/shared/providerHealth";

export type ShadowTrackableCard = {
  assetClass: SignalAssetClass;
  marketSymbol?: string;
  displayName?: string;
  direction: "buy" | "sell" | "neutral";
  grade: string;
  gradeScore?: number | null;
  confidence: number;
  livePrice: number | null;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  entryTimeframe?: string | null;
  tp1RiskReward?: number | null;
  tp2RiskReward?: number | null;
  htfBiasSummary?: string | null;
  liquiditySweepDescription?: string | null;
  confluenceScore?: number | null;
  setupType?: string | null;
  location?: string | null;
  marketPhase?: string | null;
  shortReasoning?: string | null;
  detailedReasoning?: string | null;
  whyThisSetup?: string | null;
  whyNow?: string | null;
  whyThisLevel?: string | null;
  invalidation?: string | null;
  liquiditySummary?: string | null;
  marketStateLabels?: string[] | null;
  noTradeReason?: string | null;
  publicationStatus?: string | null;
  publicationReasons?: string[] | null;
  providerStatus?: string | null;
  priceSource?: string | null;
  candleSource?: string | null;
  fallbackDepth?: number | null;
  dataFreshnessMs?: number | null;
  dataTrustScore?: number | null;
  qualityScores?: {
    structure?: number;
    market?: number;
    execution?: number;
    data?: number;
    assetFit?: number;
    composite?: number;
  } | null;
};

type CaptureShadowTradePlansInput = {
  source: string;
  assetClass: SignalAssetClass;
  cycleId: string;
  generatedAt: number;
  cards: ShadowTrackableCard[];
};

type CaptureShadowTradePlansResult = {
  runId: string | null;
  signalCount: number;
  tradePlansCreated: number;
  skipped: boolean;
};

const globalForShadowTracker = globalThis as typeof globalThis & {
  __apexShadowTrackerKeys?: Set<string>;
};

const capturedShadowKeys = globalForShadowTracker.__apexShadowTrackerKeys ??= new Set<string>();

function toDbAssetClass(assetClass: SignalAssetClass): string {
  switch (assetClass) {
    case "fx":
      return "FOREX";
    case "crypto":
      return "CRYPTO";
    case "stock":
      return "STOCK";
    case "commodity":
      return "COMMODITY";
    case "index":
      return "INDEX";
    case "memecoin":
      return "MEMECOIN";
  }
}

function toSignalDirection(direction: ShadowTrackableCard["direction"]): "LONG" | "SHORT" | "NEUTRAL" {
  if (direction === "buy") return "LONG";
  if (direction === "sell") return "SHORT";
  return "NEUTRAL";
}

function toPublicationRank(card: ShadowTrackableCard): "S" | "A" | "B" | "Silent" {
  if (card.publicationStatus !== "publishable") {
    return "Silent";
  }

  if (card.grade === "S+" || card.grade === "S") return "S";
  if (card.grade === "A") return "A";
  if (card.grade === "B") return "B";
  return "Silent";
}

function inferTradePlanStatus(card: ShadowTrackableCard): "ACTIVE" | "NO_SETUP" {
  if (card.publicationStatus === "blocked" || card.livePrice == null) {
    return "NO_SETUP";
  }
  return "ACTIVE";
}

function resolveSymbol(card: ShadowTrackableCard): string {
  return card.marketSymbol ?? card.displayName ?? "UNKNOWN";
}

export function buildStoredShadowTradePlan(card: ShadowTrackableCard) {
  const providerStatus = card.providerStatus ?? (card.livePrice == null ? "broken" : "healthy");
  const fallbackUsed = (card.fallbackDepth ?? 0) > 0 || providerStatus !== "healthy";
  const publicationStatus = card.publicationStatus ?? "watchlist_only";

  return {
    style: card.assetClass === "memecoin" ? "SCALP" : "INTRADAY",
    setupFamily: card.setupType ?? null,
    bias: toSignalDirection(card.direction),
    confidence: Math.round(Math.max(0, Math.min(1, card.confidence)) * 100),
    timeframe: card.entryTimeframe ?? (card.assetClass === "stock" || card.assetClass === "index" || card.assetClass === "commodity" ? "15m" : "15m"),
    entryType: card.entry != null ? "LIMIT" : "NONE",
    entryMin: card.entry,
    entryMax: card.entry,
    stopLoss: card.sl,
    takeProfit1: card.tp1,
    takeProfit2: card.tp2,
    takeProfit3: card.tp3,
    riskRewardRatio: card.tp1RiskReward
      ?? (card.entry != null && card.sl != null && card.tp1 != null
        ? Math.abs(card.tp1 - card.entry) / Math.max(0.0000001, Math.abs(card.entry - card.sl))
        : null),
    invalidationLevel: card.sl,
    regimeTag: card.marketPhase ?? card.location ?? "unclear",
    liquidityThesis: card.liquiditySweepDescription ?? card.liquiditySummary ?? (card.marketStateLabels?.join(" · ") ?? ""),
    trapThesis: card.whyThisSetup ?? "",
    setupScore: card.confluenceScore ?? card.qualityScores?.composite ?? card.gradeScore ?? 0,
    publicationRank: toPublicationRank(card),
    publicationStatus,
    scoreBreakdown: {
      regimeAlignment: card.qualityScores?.market ?? 0,
      liquidityQuality: card.qualityScores?.structure ?? 0,
      structureConfirmation: card.qualityScores?.structure ?? 0,
      trapEdge: card.qualityScores?.assetFit ?? 0,
      entryPrecision: card.qualityScores?.execution ?? 0,
      riskReward: card.qualityScores?.execution ?? 0,
      freshness: card.qualityScores?.data ?? 0,
    },
    thesis: card.detailedReasoning ?? card.shortReasoning ?? "",
    executionNotes: [
      `publication_status=${publicationStatus}`,
      `provider_status=${providerStatus}`,
      `sweep_before_entry=${card.liquiditySweepDescription ? "true" : "false"}`,
      card.entryTimeframe ? `entry_timeframe=${card.entryTimeframe}` : null,
      card.noTradeReason ? `note=${card.noTradeReason}` : null,
    ].filter(Boolean).join(" | "),
    status: inferTradePlanStatus(card),
    providerAtSignal: card.priceSource ?? card.candleSource ?? null,
    providerHealthStateAtSignal: mapProviderStatusToSignalHealth(providerStatus),
    providerMarketStatusAtSignal: mapProviderStatusToMarketStatus(providerStatus),
    providerFallbackUsedAtSignal: fallbackUsed,
    qualityGateReason: publicationStatus === "publishable" ? null : `publication:${publicationStatus}`,
    dataQuality: resolveOutcomeDataQuality({
      providerStatus,
      fallbackUsed,
    }),
  };
}

export async function captureShadowTradePlans(input: CaptureShadowTradePlansInput): Promise<CaptureShadowTradePlansResult> {
  if (input.cards.length === 0) {
    return {
      runId: null,
      signalCount: 0,
      tradePlansCreated: 0,
      skipped: true,
    };
  }

  const captureKey = `${input.source}:${input.assetClass}:${input.cycleId}`;
  if (capturedShadowKeys.has(captureKey)) {
    return {
      runId: null,
      signalCount: 0,
      tradePlansCreated: 0,
      skipped: true,
    };
  }

  const run = await prisma.signalRun.create({
    data: {
      queuedAt: new Date(input.generatedAt),
      startedAt: new Date(input.generatedAt),
      completedAt: new Date(input.generatedAt),
      totalDurationMs: 0,
      engineVersion: ENGINE_VERSION,
      featureVersion: FEATURE_VERSION,
      promptVersion: PROMPT_VERSION,
      status: "COMPLETED",
    },
  });

  await prisma.signal.createMany({
    data: input.cards.map(card => {
      const symbol = resolveSymbol(card);
      const storedTradePlan = buildStoredShadowTradePlan(card);
      return {
        runId: run.id,
        asset: symbol,
        assetClass: toDbAssetClass(card.assetClass),
        direction: storedTradePlan.bias,
        rank: card.grade,
        total: card.qualityScores?.composite ?? card.gradeScore ?? 0,
        macro: card.qualityScores?.market ?? 0,
        structure: card.qualityScores?.structure ?? 0,
        zones: card.qualityScores?.assetFit ?? 0,
        technical: card.qualityScores?.execution ?? 0,
        timing: card.qualityScores?.data ?? 0,
        entry: card.entry,
        stopLoss: card.sl,
        tp1: card.tp1,
        tp2: card.tp2,
        tp3: card.tp3,
        brief: card.shortReasoning ?? card.detailedReasoning ?? `${symbol} shadow-tracked`,
        rawData: {
          price: {
            current: card.livePrice,
          },
          strategy: {
            publicationStatus: card.publicationStatus ?? "watchlist_only",
            qualityScores: card.qualityScores ?? null,
            topDown: {
              entryTimeframe: card.entryTimeframe ?? null,
              tp1RiskReward: card.tp1RiskReward ?? null,
              tp2RiskReward: card.tp2RiskReward ?? null,
              htfBiasSummary: card.htfBiasSummary ?? null,
              liquiditySweepDescription: card.liquiditySweepDescription ?? null,
              confluenceScore: card.confluenceScore ?? null,
              sweepBeforeEntry: Boolean(card.liquiditySweepDescription),
            },
            providerContext: {
              providerAtSignal: storedTradePlan.providerAtSignal,
              providerHealthStateAtSignal: storedTradePlan.providerHealthStateAtSignal,
              providerMarketStatusAtSignal: storedTradePlan.providerMarketStatusAtSignal,
              providerFallbackUsedAtSignal: storedTradePlan.providerFallbackUsedAtSignal,
            },
            tradePlans: [storedTradePlan],
          },
          diagnostics: {
            dataTrustScore: card.dataTrustScore ?? null,
            providerStatus: card.providerStatus ?? null,
            publicationReasons: card.publicationReasons ?? [],
          },
        },
        sentTelegram: false,
        createdAt: new Date(input.generatedAt),
      };
    }),
  });

  const tradePlansCreated = await ensureTradePlansForRun(run.id);
  capturedShadowKeys.add(captureKey);

  await prisma.systemEvent.create({
    data: {
      eventId: createId("sysevt"),
      ts: new Date(input.generatedAt),
      module: "shadow-tracker",
      type: "shadow_trade_capture_completed",
      reason: captureKey,
      payload: {
        assetClass: input.assetClass,
        cycleId: input.cycleId,
        signalCount: input.cards.length,
        tradePlansCreated,
      },
    },
  }).catch(() => undefined);

  return {
    runId: run.id,
    signalCount: input.cards.length,
    tradePlansCreated,
    skipped: false,
  };
}
