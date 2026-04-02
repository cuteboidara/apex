import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import {
  getLatestCanonicalSignalBundle,
  getLatestCycleOutput,
} from "@/src/application/signals/canonicalReadService";
import {
  createEmptySignalsPayload,
  reconstructSignalsPayloadForRuntime,
} from "@/src/application/signals/reconstructionService";
import { summarizeStageDiagnostics } from "@/src/domain/services/signalTrust";
import { generateMarketCommentary } from "@/src/lib/apex-llm";
import { getApexConfig } from "@/src/lib/config";
import { fetchLivePrices, type TraderLivePriceMap } from "@/src/lib/livePrices";
import { logger } from "@/src/lib/logger";
import { getTelegramConfig } from "@/src/lib/operatorSettings";
import { getApexRuntime } from "@/src/lib/runtime";
import type {
  TraderDetailedReasoning,
  TraderKeyAreasRow,
  TraderLiveMarketRow,
  TraderMarketCommentary,
  TraderMarketReasoningRow,
  TraderMarketStateLabel,
  TraderNoTradeReason,
  TraderOperatorPreferences,
  TraderDashboardSignal,
  TraderSignalsPayload,
  TraderSnapshotDiagnostics,
} from "@/src/lib/traderContracts";

export type CanonicalSignalEnvelope = {
  signal_id: string | null;
  symbol: string;
  display_type: "executable" | "monitored" | "rejected";
  market_snapshot_ref: string | null;
  candidate_ref: string | null;
  risk_ref: string | null;
  signal_ref: string | null;
  lifecycle_ref: string | null;
  view: SignalViewModel;
  lifecycle: Record<string, unknown> | null;
  provenance: {
    cycle_id: string;
    versions: Record<string, unknown>;
    source: "canonical";
  };
  payload_source: "canonical";
  generated_at: number;
};

export type CanonicalSignalsPayload = TraderSignalsPayload & {
  executable: SignalViewModel[];
  monitored: SignalViewModel[];
  rejected: SignalViewModel[];
  signals: CanonicalSignalEnvelope[];
  cycle_id: string;
  payload_source: "canonical";
  versions: Record<string, unknown>;
};

function uniqueBySymbol(viewModels: SignalViewModel[]): SignalViewModel[] {
  const seen = new Set<string>();
  return viewModels.filter(model => {
    if (seen.has(model.symbol)) {
      return false;
    }
    seen.add(model.symbol);
    return true;
  });
}

function toTraderDirection(direction: SignalViewModel["direction"]): TraderDashboardSignal["direction"] {
  if (direction === "buy") return "long";
  if (direction === "sell") return "short";
  return "neutral";
}

function toTraderDetailedReasoning(model: SignalViewModel): TraderDetailedReasoning {
  return {
    whyThisIsASetup: model.whyThisSetup || model.shortReasoning,
    whyNow: model.whyNow || model.summary,
    whyThisLevel: model.whyThisLevel || model.keyLevelsSummary || "No specific level rationale recorded.",
    whatWouldInvalidateIt: model.invalidation || "A structural break through the monitored invalidation zone would void the setup.",
    whyItGotItsGrade: model.whyThisGrade || `Grade ${model.grade} reflects current confidence and confluence.`,
  };
}

function toLegacyCard(model: SignalViewModel): TraderDashboardSignal {
  return {
    symbol: model.symbol,
    livePrice: model.livePrice,
    direction: toTraderDirection(model.direction),
    grade: model.grade as TraderDashboardSignal["grade"],
    setupType: model.setupType as TraderDashboardSignal["setupType"],
    session: model.session,
    bias: model.bias as TraderDashboardSignal["bias"],
    structure: model.structure as TraderDashboardSignal["structure"],
    liquidityState: model.liquidityState as TraderDashboardSignal["liquidityState"],
    location: model.location as TraderDashboardSignal["location"],
    zoneType: model.zoneType as TraderDashboardSignal["zoneType"],
    marketPhase: model.marketPhase as TraderDashboardSignal["marketPhase"],
    entry: model.entry,
    sl: model.sl,
    tp1: model.tp1,
    tp2: model.tp2,
    tp3: model.tp3,
    entryTimeframe: model.entryTimeframe ?? null,
    tp1RiskReward: model.tp1RiskReward ?? null,
    tp2RiskReward: model.tp2RiskReward ?? null,
    htfBiasSummary: model.htfBiasSummary ?? null,
    liquiditySweepDescription: model.liquiditySweepDescription ?? null,
    confluenceScore: model.confluenceScore ?? null,
    shortReasoning: model.shortReasoning,
    detailedReasoning: toTraderDetailedReasoning(model),
    whyThisSetup: model.whyThisSetup,
    whyNow: model.whyNow,
    whyThisLevel: model.whyThisLevel,
    invalidation: model.invalidation,
    whyThisGrade: model.whyThisGrade,
    noTradeExplanation: model.noTradeExplanation,
    marketStructureSummary: model.marketStructureSummary,
    liquiditySummary: model.liquiditySummary,
    keyLevelsSummary: model.keyLevelsSummary,
    keyLevels: {
      previousDayHigh: model.keyLevels.pdh,
      previousDayLow: model.keyLevels.pdl,
      sessionHigh: model.keyLevels.sessionHigh,
      sessionLow: model.keyLevels.sessionLow,
      location: model.location as TraderDashboardSignal["keyLevels"]["location"],
      activeZone: model.zoneType === "neutral" ? null : model.zoneType,
    },
    noTradeReason: model.noTradeReason as TraderNoTradeReason | null,
    whyNotValid: model.displayCategory === "rejected"
      ? model.riskExplainability.join(" · ") || model.noTradeExplanation
      : null,
    marketStateLabels: model.marketStateLabels as TraderMarketStateLabel[],
    status: model.status,
    blockedReasons: model.blockedReasons,
    latestLifecycle: null,
    lifecycleState: model.lifecycleState,
    confidence: model.confidence,
    podVoteSummary: {
      directional: model.podVotes.map(vote => ({
        pod_id: vote.podName,
        pod_category: "directional",
        direction: vote.signal === "buy" ? "buy" : vote.signal === "sell" ? "sell" : "none",
        confidence: vote.confidence,
        weight: vote.confidence,
        score: vote.score,
        rationale: [vote.reasoning],
      })),
      gating: [],
    },
    smcAnalysis: model.smcAnalysis,
  };
}

function buildLiveMarketBoard(viewModels: SignalViewModel[], livePrices: TraderLivePriceMap): TraderLiveMarketRow[] {
  const config = getApexConfig();

  return config.activeSymbols.map(symbol => {
    const model = viewModels.find(item => item.symbol === symbol);
    return {
      symbol,
      livePrice: livePrices[symbol] ?? model?.livePrice ?? null,
      session: model?.session ?? "Awaiting cycle",
      bias: (model?.bias as TraderLiveMarketRow["bias"]) ?? "neutral",
      grade: model?.grade ? model.grade as TraderLiveMarketRow["grade"] : null,
      noTradeReason: (model?.noTradeReason as TraderLiveMarketRow["noTradeReason"]) ?? null,
      marketStateLabels: (model?.marketStateLabels as TraderLiveMarketRow["marketStateLabels"]) ?? [],
      status: model?.status ?? "watchlist",
    };
  });
}

function buildMarketReasoning(viewModels: SignalViewModel[]): TraderMarketReasoningRow[] {
  return uniqueBySymbol(viewModels).map(model => ({
    symbol: model.symbol,
    summary: model.shortReasoning || model.noTradeExplanation || model.summary,
    grade: model.grade as TraderMarketReasoningRow["grade"],
    noTradeReason: model.noTradeReason as TraderMarketReasoningRow["noTradeReason"],
    marketStateLabels: model.marketStateLabels as TraderMarketReasoningRow["marketStateLabels"],
    status: model.status,
  }));
}

function buildKeyAreas(viewModels: SignalViewModel[]): TraderKeyAreasRow[] {
  return uniqueBySymbol(viewModels).map(model => ({
    symbol: model.symbol,
    previousDayHigh: model.keyLevels.pdh,
    previousDayLow: model.keyLevels.pdl,
    sessionHigh: model.keyLevels.sessionHigh,
    sessionLow: model.keyLevels.sessionLow,
    location: model.location as TraderKeyAreasRow["location"],
    activeZone: model.zoneType === "neutral" ? null : model.zoneType,
  }));
}

function buildDiagnostics(viewModels: SignalViewModel[], cycleId: string): TraderSnapshotDiagnostics[] {
  return uniqueBySymbol(viewModels).map(model => ({
    symbol: model.symbol,
    cycleId,
    generatedAt: model.generatedAt,
    marketData: {
      symbol: model.symbol,
      interval: "15min",
      provider: model.lastSuccessfulProvider ?? model.priceSource ?? model.candleSource ?? null,
      candlesFetched: 0,
      lastCandleTimestamp: typeof model.dataFreshnessMs === "number"
        ? Math.max(0, model.generatedAt - model.dataFreshnessMs)
        : null,
      latencyMs: 0,
      sourceMode: model.providerStatus === "broken"
        ? "unavailable"
        : model.providerStatus === "stale"
          ? "cache"
          : "live",
      usedFallback: model.providerStatus === "fallback" || model.providerStatus === "degraded" || model.providerStatus === "stale",
      qualityFlag: model.providerStatus === "stale"
        ? "stale_last_candle"
        : model.missingBarCount && model.missingBarCount > 0
          ? "missing_bars"
          : null,
      unavailableReason: null,
    },
    snapshotAvailable: true,
    snapshotCreated: true,
    snapshotTimestamp: model.generatedAt,
    candidateCreated: model.displayCategory !== "rejected" || model.riskRuleCodes.length > 0,
    traderCardCreated: true,
    cardStatus: model.status,
    approvalStatus: model.riskStatus,
    noTradeReason: model.noTradeReason,
    blockedReasons: model.blockedReasons,
    unavailableReason: null,
    providerStatus: model.providerStatus ?? null,
    publicationStatus: model.publicationStatus ?? null,
    dataTrustScore: model.dataTrustScore ?? null,
    healthFlags: model.healthFlags ?? [],
  }));
}

function toCanonicalSignalEnvelope(input: {
  cycleId: string;
  versions: Record<string, unknown>;
  viewModel: SignalViewModel;
  cycleOutput: Awaited<ReturnType<typeof getLatestCycleOutput>>;
  lifecycles: Awaited<ReturnType<typeof getLatestCanonicalSignalBundle>>["lifecycles"];
}): CanonicalSignalEnvelope {
  const snapshot = input.cycleOutput.snapshots.find(item => item.symbol === input.viewModel.symbol) ?? null;
  const candidate = input.cycleOutput.candidates.find(item => item.symbol === input.viewModel.symbol) ?? null;
  const risk = candidate
    ? input.cycleOutput.risk_results.find(item => item.candidate_id === candidate.candidate_id) ?? null
    : null;
  const signal = input.viewModel.signal_id
    ? input.cycleOutput.signals.find(item => item.signal_id === input.viewModel.signal_id) ?? null
    : candidate
      ? input.cycleOutput.signals.find(item => item.candidate_id === candidate.candidate_id) ?? null
      : null;
  const lifecycle = signal ? input.lifecycles.get(signal.signal_id) ?? null : null;

  return {
    signal_id: input.viewModel.signal_id,
    symbol: input.viewModel.symbol,
    display_type: input.viewModel.displayCategory,
    market_snapshot_ref: snapshot?.snapshot_id ?? null,
    candidate_ref: candidate?.candidate_id ?? null,
    risk_ref: risk?.candidate_id ?? null,
    signal_ref: signal?.signal_id ?? null,
    lifecycle_ref: lifecycle?.signal_id ?? null,
    view: input.viewModel,
    lifecycle: lifecycle
      ? {
        signal_id: lifecycle.signal_id,
        current_state: lifecycle.current_state,
        fill_status: lifecycle.fill_status,
        opened_at: lifecycle.opened_at,
        updated_at: lifecycle.updated_at,
        closed_at: lifecycle.closed_at,
        pnl: lifecycle.pnl,
        execution_events: lifecycle.execution_events,
      }
      : null,
    provenance: {
      cycle_id: input.cycleId,
      versions: input.versions,
      source: "canonical",
    },
    payload_source: "canonical",
    generated_at: input.viewModel.generatedAt,
  };
}

async function buildMarketCommentaryFromViewModels(
  viewModels: SignalViewModel[],
): Promise<TraderMarketCommentary | null> {
  const marketStates = Object.fromEntries(uniqueBySymbol(viewModels).map(model => ([
    model.symbol,
    {
      bias: model.bias,
      phase: model.marketPhase,
      session: model.session,
      labels: model.marketStateLabels,
    },
  ])));
  return generateMarketCommentary(
    uniqueBySymbol(viewModels).map(model => model.symbol),
    marketStates,
  );
}

function groupViewModels(viewModels: SignalViewModel[]) {
  return {
    executable: viewModels.filter(model => model.displayCategory === "executable"),
    monitored: viewModels.filter(model => model.displayCategory === "monitored"),
    rejected: viewModels.filter(model => model.displayCategory === "rejected"),
  };
}

function buildPipelineDiagnostics(input: {
  cycleOutput: Awaited<ReturnType<typeof getLatestCycleOutput>>;
  viewModels: SignalViewModel[];
}): Record<string, unknown> {
  const persisted = input.cycleOutput.metadata.pipeline_diagnostics as Record<string, unknown> | undefined;
  if (persisted) {
    return persisted;
  }

  return summarizeStageDiagnostics({
    cycleId: input.cycleOutput.cycle_id,
    startedAt: input.cycleOutput.started_at,
    completedAt: input.cycleOutput.completed_at,
    symbolsProcessed: input.cycleOutput.symbols_processed,
    snapshots: input.cycleOutput.snapshots,
    candidates: input.cycleOutput.candidates,
    riskResults: input.cycleOutput.risk_results,
    signals: input.cycleOutput.signals,
    viewModels: input.viewModels,
  });
}

async function buildPreferences(): Promise<TraderOperatorPreferences> {
  const config = getApexConfig();
  const telegramConfig = await getTelegramConfig();
  return {
    meaningfulSignalFloor: "B",
    minimumTelegramGrade: telegramConfig.minGrade,
    includeBTelegramSignals: telegramConfig.includeBGrade,
    showBlockedSignalsOnMainDashboard: config.showBlockedSignalsOnMainDashboard,
    showAdvancedInternals: config.showAdvancedInternals,
  };
}

export async function getCanonicalSignalsPayload(dependencies?: {
  readCanonicalBundle?: typeof getLatestCanonicalSignalBundle;
  fetchPrices?: typeof fetchLivePrices;
  buildCompatibilityPayload?: unknown;
}): Promise<CanonicalSignalsPayload> {
  const canonicalBundle = await (dependencies?.readCanonicalBundle ?? getLatestCanonicalSignalBundle)();
  const config = getApexConfig();
  const symbolsForLiveBoard = Array.from(new Set([
    ...config.activeSymbols,
    ...canonicalBundle.cycleOutput.symbols_processed,
    ...canonicalBundle.viewModels.map(model => model.symbol),
  ]));
  const livePrices = await (dependencies?.fetchPrices ?? fetchLivePrices)(symbolsForLiveBoard);
  const viewModels = canonicalBundle.viewModels.map(model => ({
    ...model,
    livePrice: livePrices[model.symbol] ?? model.livePrice ?? null,
  }));
  const grouped = groupViewModels(viewModels);
  const cards = viewModels.map(toLegacyCard);
  const preferences = await buildPreferences();

  if (viewModels.length === 0) {
    throw new Error("CANONICAL_TRUTH_MISSING");
  }

  return {
    generatedAt: Date.now(),
    executable: grouped.executable,
    monitored: grouped.monitored,
    rejected: grouped.rejected,
    cards,
    liveMarketBoard: buildLiveMarketBoard(viewModels, livePrices),
    activeSignals: grouped.executable.map(toLegacyCard).filter(card => card.status === "active"),
    developingSetups: grouped.monitored.map(toLegacyCard),
    blockedSignals: grouped.rejected.map(toLegacyCard),
    watchlistSignals: [...grouped.monitored, ...grouped.rejected]
      .map(toLegacyCard)
      .filter(card => card.status === "watchlist"),
    marketReasoning: buildMarketReasoning(viewModels),
    keyAreas: buildKeyAreas(viewModels),
    diagnostics: buildDiagnostics(viewModels, canonicalBundle.cycleOutput.cycle_id),
    pipelineDiagnostics: buildPipelineDiagnostics({
      cycleOutput: canonicalBundle.cycleOutput,
      viewModels,
    }),
    preferences,
    marketCommentary: await buildMarketCommentaryFromViewModels(viewModels),
    signals: viewModels.map(viewModel =>
      toCanonicalSignalEnvelope({
        cycleId: canonicalBundle.cycleOutput.cycle_id,
        versions: canonicalBundle.cycleOutput.versions as Record<string, unknown>,
        viewModel,
        cycleOutput: canonicalBundle.cycleOutput,
        lifecycles: canonicalBundle.lifecycles,
      })),
    cycle_id: canonicalBundle.cycleOutput.cycle_id,
    payload_source: "canonical",
    versions: canonicalBundle.cycleOutput.versions as Record<string, unknown>,
  };
}

export async function getSignalsPayloadForRuntime(
  runtime: ReturnType<typeof getApexRuntime>,
  dependencies?: {
    fetchLivePrices?: (symbols: readonly string[]) => Promise<TraderLivePriceMap>;
  },
) {
  return reconstructSignalsPayloadForRuntime(runtime, {
    debugMode: true,
    reconstructionReason: "legacy_runtime_debug_helper",
    fetchLivePrices: dependencies?.fetchLivePrices,
  });
}

export async function getSignalsPayload() {
  try {
    return await getCanonicalSignalsPayload();
  } catch (error) {
    logger.error({
      module: "signals-api",
      message: "Canonical signals payload unavailable",
      error: String(error),
      canonical_read_failures: 1,
    });
    throw error;
  }
}

export { createEmptySignalsPayload };
