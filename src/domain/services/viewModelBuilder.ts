import type {
  CycleOutput,
  ExecutableSignal,
  MarketSnapshot,
  RiskEvaluatedCandidate,
  SignalLifecycle,
  SignalViewDisplayType,
  SignalViewModel,
  SignalViewRiskStatus,
  SignalViewStatus,
  TradeCandidate,
} from "@/src/domain/models/signalPipeline";
import type { PublicationStatus, SignalDataTrust, SignalQualityScores, SignalRejectionReasonCode } from "@/src/domain/models/signalHealth";
import { buildDataTrust, buildHealthFlags, buildPublicationState, buildQualityScores } from "@/src/domain/services/signalTrust";
import { createId } from "@/src/lib/ids";
import type { TraderPairRuntimeState, TraderSignalGrade } from "@/src/lib/traderContracts";

type BuildViewModelInput = {
  state?: TraderPairRuntimeState;
  snapshot: MarketSnapshot | null;
  candidate: TradeCandidate | null;
  risk: RiskEvaluatedCandidate | null;
  signal: ExecutableSignal | null;
  lifecycle: SignalLifecycle | null;
};

const GRADE_SCORE: Record<TraderSignalGrade, number> = {
  "S+": 98,
  S: 92,
  A: 84,
  B: 72,
  C: 58,
  D: 36,
  F: 18,
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function mapDirection(direction: string | null | undefined): SignalViewModel["direction"] {
  if (direction === "long" || direction === "buy") return "buy";
  if (direction === "short" || direction === "sell") return "sell";
  return "neutral";
}

function gradeScore(grade: string | null | undefined): number {
  if (!grade) {
    return 0;
  }
  return GRADE_SCORE[grade as TraderSignalGrade] ?? 0;
}

function isWatchlistOnlyRuntime(input: BuildViewModelInput): boolean {
  const cardStatus = input.state?.card?.status ?? null;
  const candidateDirection = input.candidate?.direction ?? null;
  return input.signal == null
    && candidateDirection === "none"
    && cardStatus === "watchlist";
}

function resolveRiskStatus(input: BuildViewModelInput): SignalViewRiskStatus {
  if (
    isWatchlistOnlyRuntime(input)
    || input.risk?.publication_status === "watchlist_only"
    || input.risk?.publication_status === "shadow_only"
  ) {
    return "deferred";
  }
  if (input.risk?.decision === "blocked") return "rejected";
  if (input.risk?.decision === "modified") return "reduced";
  if (input.risk?.decision === "approved") return "approved";
  return "deferred";
}

function resolveDisplayCategory(input: BuildViewModelInput & { state: TraderPairRuntimeState }, grade: string, riskStatus: SignalViewRiskStatus): SignalViewDisplayType {
  if (
    riskStatus === "rejected"
    || input.lifecycle?.current_state === "invalidated"
    || input.lifecycle?.current_state === "expired"
    || input.state.card?.status === "blocked"
  ) {
    return "rejected";
  }

  if ((riskStatus === "approved" || riskStatus === "reduced") && gradeScore(grade) >= gradeScore("B")) {
    return "executable";
  }

  return "monitored";
}

function resolveStatus(input: BuildViewModelInput & { state: TraderPairRuntimeState }, grade: string, riskStatus: SignalViewRiskStatus): SignalViewStatus {
  if (input.lifecycle?.current_state === "invalidated") return "invalidated";
  if (input.lifecycle?.current_state === "expired") return "expired";
  if (riskStatus === "rejected" || input.state.card?.status === "blocked") return "blocked";
  if ((riskStatus === "approved" || riskStatus === "reduced") && gradeScore(grade) >= gradeScore("B")) return "active";
  return "watchlist";
}

function buildRiskExplainability(ruleCodes: string[]): string[] {
  return ruleCodes.map(rule => rule.replaceAll(".", " ").replaceAll("_", " "));
}

function buildFallbackState(input: Omit<BuildViewModelInput, "state">): TraderPairRuntimeState {
  const symbol = input.snapshot?.symbol ?? input.candidate?.symbol ?? input.signal?.symbol ?? "UNKNOWN";
  const fallbackLivePrice = input.signal?.entry
    ?? input.candidate?.proposed_trade_plan?.entry
    ?? (typeof input.snapshot?.features?.mid === "number" ? input.snapshot.features.mid : null);
  const watchlistOnlyFallback = input.signal == null && input.candidate?.direction === "none";
  const fallbackStatus = input.risk?.decision === "blocked" && !watchlistOnlyFallback ? "blocked" : "watchlist";
  return {
    symbol,
    cycleId: input.snapshot?.cycle_id ?? input.signal?.cycle_id ?? "unknown",
    generatedAt: input.snapshot?.created_at ?? input.signal?.created_at ?? Date.now(),
    snapshotAvailable: Boolean(input.snapshot),
    liveMarket: {
      symbol,
      livePrice: fallbackLivePrice,
      session: input.snapshot?.market_session_context.session ?? "unknown",
      bias: "neutral",
      grade: null,
      noTradeReason: null,
      marketStateLabels: [],
      status: fallbackStatus,
    },
    marketReasoning: {
      symbol,
      summary: fallbackStatus === "blocked" ? "Candidate was rejected by risk." : "Monitoring canonical market state.",
      grade: null,
      noTradeReason: null,
      marketStateLabels: [],
      status: fallbackStatus,
    },
    keyAreas: {
      symbol,
      previousDayHigh: null,
      previousDayLow: null,
      sessionHigh: null,
      sessionLow: null,
      location: "neutral",
      activeZone: null,
    },
    card: null,
    diagnostics: {
      symbol,
      cycleId: input.snapshot?.cycle_id ?? input.signal?.cycle_id ?? "unknown",
      generatedAt: input.snapshot?.created_at ?? input.signal?.created_at ?? Date.now(),
      marketData: {
        symbol,
        interval: "15min",
        provider: null,
        candlesFetched: 0,
        lastCandleTimestamp: null,
        latencyMs: 0,
        sourceMode: "live",
        usedFallback: false,
        qualityFlag: null,
        unavailableReason: null,
      },
      snapshotAvailable: Boolean(input.snapshot),
      snapshotCreated: Boolean(input.snapshot),
      snapshotTimestamp: input.snapshot?.timestamp ?? null,
      candidateCreated: Boolean(input.candidate),
      traderCardCreated: false,
      cardStatus: null,
      approvalStatus: input.risk?.decision ?? null,
      noTradeReason: null,
      blockedReasons: input.risk?.blocking_rules ?? [],
      unavailableReason: null,
    },
  };
}

function buildHeadline(symbol: string, direction: SignalViewModel["direction"], setupType: string, displayCategory: SignalViewDisplayType): string {
  if (displayCategory === "rejected") {
    return `${symbol} REJECTED`;
  }
  if (displayCategory === "monitored" && direction === "neutral") {
    return `${symbol} MONITORED`;
  }
  return `${symbol} ${direction.toUpperCase()} ${setupType.toUpperCase()}`;
}

function buildSummary(input: BuildViewModelInput & { state: TraderPairRuntimeState }, shortReasoning: string, noTradeExplanation: string | null): string {
  return shortReasoning || noTradeExplanation || input.state.marketReasoning.summary;
}

function buildReasonLabels(input: BuildViewModelInput & { state: TraderPairRuntimeState }, riskRuleCodes: string[]): string[] {
  return [...new Set([
    ...riskRuleCodes,
    ...input.state.card?.marketStateLabels ?? [],
    ...input.state.card?.blockedReasons ?? [],
    ...(input.state.card?.noTradeReason ? [input.state.card.noTradeReason] : []),
  ])];
}

function buildConfidenceLabel(confidence: number, grade: string): string | null {
  if (!Number.isFinite(confidence)) {
    return grade || null;
  }
  return `${Math.round(confidence * 100)}% · ${grade}`;
}

function resolveDataTrust(input: BuildViewModelInput & { state: TraderPairRuntimeState }): SignalDataTrust {
  if (input.snapshot?.data_health) {
    return input.snapshot.data_health;
  }

  const diagnostics = input.state.diagnostics.marketData;
  return buildDataTrust({
    assetClass: "fx",
    providerStatus: diagnostics.sourceMode === "unavailable"
      ? "broken"
      : diagnostics.usedFallback
        ? "fallback"
        : diagnostics.qualityFlag === "stale_last_candle"
          ? "stale"
          : diagnostics.qualityFlag && diagnostics.qualityFlag !== "clean"
            ? "degraded"
            : "healthy",
    priceSource: diagnostics.provider,
    candleSource: diagnostics.provider,
    fallbackDepth: diagnostics.usedFallback ? 1 : 0,
    dataFreshnessMs: diagnostics.lastCandleTimestamp == null
      ? null
      : Math.max(0, input.state.generatedAt - diagnostics.lastCandleTimestamp),
    missingBarCount: diagnostics.qualityFlag === "missing_bars" ? 1 : 0,
    lastSuccessfulProvider: diagnostics.provider,
    quoteIntegrity: diagnostics.sourceMode !== "unavailable" && diagnostics.qualityFlag !== "duplicate_bars" && diagnostics.qualityFlag !== "out_of_order",
    universeMembershipConfidence: input.snapshot?.universe_membership_confidence ?? 1,
  });
}

function resolveQualityScores(
  input: BuildViewModelInput & { state: TraderPairRuntimeState },
  dataTrust: SignalDataTrust,
): SignalQualityScores {
  if (input.signal?.quality_scores) {
    return input.signal.quality_scores;
  }
  if (input.risk?.quality_scores) {
    return input.risk.quality_scores;
  }
  if (input.candidate?.quality_scores) {
    return input.candidate.quality_scores;
  }

  return buildQualityScores({
    structure: (input.state.card?.confidence ?? 0) * 100,
    market: input.state.card?.status === "blocked" ? 24 : 68,
    execution: input.signal ? 80 : 48,
    data: dataTrust.dataTrustScore,
    assetFit: 84,
  });
}

function resolvePublication(
  input: BuildViewModelInput & { state: TraderPairRuntimeState },
  dataTrust: SignalDataTrust,
  qualityScores: SignalQualityScores,
): { status: PublicationStatus; reasons: SignalRejectionReasonCode[]; health: SignalViewModel["moduleHealth"] } {
  const preferRuntimeWatchlist = isWatchlistOnlyRuntime(input);
  const existing = input.signal?.publication_status
    ?? input.risk?.publication_status
    ?? input.candidate?.publication_status
    ?? null;
  const existingReasons = input.signal?.publication_reasons
    ?? input.risk?.publication_reasons
    ?? input.candidate?.publication_reasons
    ?? [];
  const existingHealth = input.signal?.module_health
    ?? input.risk?.module_health
    ?? input.candidate?.module_health
    ?? null;

  if (existing && !(preferRuntimeWatchlist && existing === "blocked")) {
    return {
      status: existing,
      reasons: existingReasons,
      health: existingHealth ?? undefined,
    };
  }

  return buildPublicationState({
    providerStatus: dataTrust.providerStatus,
    livePrice: input.state.card?.livePrice ?? input.state.liveMarket.livePrice,
    quoteIntegrity: dataTrust.quoteIntegrity,
    dataTrustScore: dataTrust.dataTrustScore,
    qualityScores,
    noTradeReason: preferRuntimeWatchlist
      ? input.state.card?.noTradeReason ?? input.state.marketReasoning.noTradeReason ?? "no structure"
      : input.state.card?.noTradeReason ?? input.state.marketReasoning.noTradeReason,
    riskStatus: preferRuntimeWatchlist ? "deferred" : resolveRiskStatus(input),
    blockedReasons: preferRuntimeWatchlist ? [] : input.state.card?.blockedReasons ?? input.risk?.blocking_rules ?? [],
    forceWatchlist: preferRuntimeWatchlist || input.state.card?.status === "watchlist",
  });
}

function resolveAssetClassLabel(input: BuildViewModelInput & { state: TraderPairRuntimeState }): SignalViewModel["assetClass"] {
  return (input.state.card as { assetClass?: SignalViewModel["assetClass"] } | null | undefined)?.assetClass
    ?? input.snapshot?.asset_class
    ?? "fx";
}

function resolveDisplayCategoryForPublication(
  displayCategory: SignalViewDisplayType,
  publicationStatus: PublicationStatus,
): SignalViewDisplayType {
  if (publicationStatus === "blocked") {
    return "rejected";
  }
  if (publicationStatus === "publishable") {
    return displayCategory;
  }
  if (displayCategory === "executable") {
    return "monitored";
  }
  return displayCategory;
}

function resolveStatusForPublication(
  status: SignalViewStatus,
  publicationStatus: PublicationStatus,
): SignalViewStatus {
  if (status === "invalidated" || status === "expired") {
    return status;
  }
  if (publicationStatus === "blocked") {
    return "blocked";
  }
  if (publicationStatus === "publishable") {
    return status;
  }
  return "watchlist";
}

function fromPersistedModel(record: Record<string, unknown>, livePrice: number | null | undefined): SignalViewModel {
  const base = record as unknown as SignalViewModel;
  return {
    ...base,
    livePrice: livePrice ?? base.livePrice ?? null,
  };
}

function buildFallbackPersistedViewModel(input: {
  viewId: string;
  entityRef: string;
  displayType: SignalViewDisplayType;
  headline: string;
  summary: string;
  reasonLabels: string[];
  confidenceLabel: string | null;
  uiSections: Record<string, unknown>;
  commentary: Record<string, unknown> | null;
  uiVersion: string;
  generatedAt: number;
  livePrice?: number | null;
}): SignalViewModel {
  const snapshot = asRecord(input.uiSections.snapshot);
  const signal = asRecord(input.uiSections.signal);
  const risk = asRecord(input.uiSections.risk);
  const card = asRecord(input.uiSections.card);
  const direction = mapDirection(
    typeof signal.direction === "string"
      ? signal.direction
      : typeof card.direction === "string"
        ? card.direction
        : null,
  );

  return {
    id: input.viewId,
    view_id: input.viewId,
    entity_ref: input.entityRef,
    signal_id: typeof signal.signal_id === "string" ? signal.signal_id : null,
    symbol: typeof snapshot.symbol === "string"
      ? snapshot.symbol
      : typeof card.symbol === "string"
        ? card.symbol
        : "UNKNOWN",
    cycleId: typeof snapshot.cycle_id === "string" ? snapshot.cycle_id : "unknown",
    generatedAt: input.generatedAt,
    generated_at: input.generatedAt,
    displayCategory: input.displayType,
    display_type: input.displayType,
    livePrice: input.livePrice ?? null,
    entry: typeof signal.entry === "number" ? signal.entry : null,
    sl: typeof signal.stop_loss === "number" ? signal.stop_loss : null,
    tp1: null,
    tp2: null,
    tp3: null,
    direction,
    grade: typeof card.grade === "string" ? card.grade : "F",
    gradeScore: gradeScore(typeof card.grade === "string" ? card.grade : "F"),
    setupType: typeof card.setupType === "string" ? card.setupType : "monitored setup",
    session: typeof card.session === "string" ? card.session : "unknown",
    bias: typeof card.bias === "string" ? card.bias : "neutral",
    structure: typeof card.structure === "string" ? card.structure : "neutral",
    liquidityState: typeof card.liquidityState === "string" ? card.liquidityState : "neutral",
    location: typeof card.location === "string" ? card.location : "neutral",
    zoneType: typeof card.zoneType === "string" ? card.zoneType : "neutral",
    marketPhase: typeof card.marketPhase === "string" ? card.marketPhase : "neutral",
    confidence: typeof card.confidence === "number" ? card.confidence : 0,
    shortReasoning: input.summary,
    detailedReasoning: typeof input.commentary?.detailed_reasoning === "string" ? input.commentary.detailed_reasoning : input.summary,
    whyThisSetup: "",
    whyNow: "",
    whyThisLevel: "",
    invalidation: "",
    whyThisGrade: "",
    noTradeExplanation: null,
    marketStateLabels: [],
    noTradeReason: null,
    blockedReasons: Array.isArray(risk.blocking_rules) ? risk.blocking_rules.filter((item): item is string => typeof item === "string") : [],
    riskStatus: input.displayType === "rejected" ? "rejected" : input.displayType === "executable" ? "approved" : "deferred",
    riskRuleCodes: Array.isArray(risk.blocking_rules) ? risk.blocking_rules.filter((item): item is string => typeof item === "string") : [],
    riskExplainability: Array.isArray(risk.blocking_rules) ? buildRiskExplainability(risk.blocking_rules.filter((item): item is string => typeof item === "string")) : [],
    podVotes: [],
    lifecycleState: null,
    status: input.displayType === "rejected" ? "blocked" : input.displayType === "executable" ? "active" : "watchlist",
    keyLevels: {
      pdh: null,
      pdl: null,
      sessionHigh: null,
      sessionLow: null,
    },
    marketStructureSummary: "",
    liquiditySummary: "",
    keyLevelsSummary: "",
    headline: input.headline,
    summary: input.summary,
    reason_labels: input.reasonLabels,
    confidence_label: input.confidenceLabel,
    ui_sections: input.uiSections,
    commentary: input.commentary,
    ui_version: input.uiVersion,
  };
}

export class SignalViewModelBuilder {
  /**
   * Builds a persisted SignalViewModel from canonical refs and cycle-time enrichment state.
   * This remains the only builder for UI-facing models.
   */
  static build(input: BuildViewModelInput): SignalViewModel | null {
    return SignalViewModelBuilder.buildFromRuntimeState(input);
  }

  static buildFromRuntimeState(input: BuildViewModelInput): SignalViewModel | null {
    const state = input.state ?? buildFallbackState({
      snapshot: input.snapshot,
      candidate: input.candidate,
      risk: input.risk,
      signal: input.signal,
      lifecycle: input.lifecycle,
    });
    const entityRef = input.signal?.signal_id ?? input.candidate?.candidate_id ?? input.snapshot?.snapshot_id ?? null;
    if (!entityRef) {
      return null;
    }

    const viewId = createId("view");
    const card = state.card;
    const symbol = state.symbol;
    const grade = card?.grade ?? (input.signal ? "B" : "F");
    const resolvedInput = { ...input, state };
    const riskStatus = resolveRiskStatus(resolvedInput);
    const dataTrust = resolveDataTrust(resolvedInput);
    const qualityScores = resolveQualityScores(resolvedInput, dataTrust);
    const publication = resolvePublication(resolvedInput, dataTrust, qualityScores);
    const displayCategory = resolveDisplayCategoryForPublication(
      resolveDisplayCategory(resolvedInput, grade, riskStatus),
      publication.status,
    );
    const status = resolveStatusForPublication(
      resolveStatus(resolvedInput, grade, riskStatus),
      publication.status,
    );
    const blockedReasons = card?.blockedReasons ?? input.risk?.blocking_rules ?? [];
    const riskRuleCodes = [...new Set([
      ...input.risk?.blocking_rules ?? [],
      ...(riskStatus === "rejected" ? input.risk?.warnings ?? [] : []),
    ])];
    const podVotes = [
      ...card?.podVoteSummary?.directional ?? [],
      ...card?.podVoteSummary?.gating ?? [],
    ].map(vote => ({
      podName: vote.pod_id,
      signal: vote.direction === "buy" ? "buy" : vote.direction === "sell" ? "sell" : "neutral",
      confidence: vote.confidence,
      score: typeof vote.score === "number" ? vote.score : Math.round(vote.confidence * 100),
      reasoning: vote.rationale.join(" "),
    }));

    const model: SignalViewModel = {
      id: viewId,
      view_id: viewId,
      entity_ref: entityRef,
      signal_id: input.signal?.signal_id ?? null,
      symbol,
      cycleId: state.cycleId,
      generatedAt: state.generatedAt,
      generated_at: state.generatedAt,
      displayCategory,
      display_type: displayCategory,
      livePrice: card?.livePrice ?? state.liveMarket.livePrice ?? null,
      entry: card?.entry ?? null,
      sl: card?.sl ?? null,
      tp1: card?.tp1 ?? null,
      tp2: card?.tp2 ?? null,
      tp3: card?.tp3 ?? null,
      direction: mapDirection(card?.direction),
      grade,
      gradeScore: gradeScore(grade),
      setupType: card?.setupType ?? "monitored setup",
      session: card?.session ?? state.liveMarket.session,
      bias: card?.bias ?? state.liveMarket.bias,
      structure: card?.structure ?? "neutral",
      liquidityState: card?.liquidityState ?? "neutral",
      location: card?.location ?? "neutral",
      zoneType: card?.zoneType ?? "neutral",
      marketPhase: card?.marketPhase ?? "neutral",
      confidence: card?.confidence ?? 0,
      entryTimeframe: card?.entryTimeframe ?? null,
      tp1RiskReward: card?.tp1RiskReward ?? null,
      tp2RiskReward: card?.tp2RiskReward ?? null,
      htfBiasSummary: card?.htfBiasSummary ?? null,
      liquiditySweepDescription: card?.liquiditySweepDescription ?? null,
      confluenceScore: card?.confluenceScore ?? null,
      shortReasoning: card?.shortReasoning ?? state.marketReasoning.summary,
      detailedReasoning: card?.detailedReasoning?.whyThisIsASetup
        ? [
          card.detailedReasoning.whyThisIsASetup,
          card.detailedReasoning.whyNow,
          card.detailedReasoning.whyThisLevel,
          card.detailedReasoning.whatWouldInvalidateIt,
          card.detailedReasoning.whyItGotItsGrade,
        ].filter(Boolean).join(" ")
        : state.marketReasoning.summary,
      whyThisSetup: card?.whyThisSetup ?? card?.detailedReasoning?.whyThisIsASetup ?? "",
      whyNow: card?.whyNow ?? card?.detailedReasoning?.whyNow ?? "",
      whyThisLevel: card?.whyThisLevel ?? card?.detailedReasoning?.whyThisLevel ?? "",
      invalidation: card?.invalidation ?? card?.detailedReasoning?.whatWouldInvalidateIt ?? "",
      whyThisGrade: card?.whyThisGrade ?? card?.detailedReasoning?.whyItGotItsGrade ?? "",
      noTradeExplanation: card?.noTradeExplanation ?? null,
      smcAnalysis: card?.smcAnalysis,
      marketStateLabels: card?.marketStateLabels ?? state.liveMarket.marketStateLabels,
      noTradeReason: card?.noTradeReason ?? state.marketReasoning.noTradeReason,
      blockedReasons,
      riskStatus,
      riskRuleCodes,
      riskExplainability: buildRiskExplainability(riskRuleCodes),
      podVotes: podVotes as SignalViewModel["podVotes"],
      lifecycleState: card?.lifecycleState ?? input.lifecycle?.current_state ?? null,
      status,
      keyLevels: {
        pdh: card?.keyLevels.previousDayHigh ?? null,
        pdl: card?.keyLevels.previousDayLow ?? null,
        sessionHigh: card?.keyLevels.sessionHigh ?? null,
        sessionLow: card?.keyLevels.sessionLow ?? null,
      },
      marketStructureSummary: card?.marketStructureSummary ?? "",
      liquiditySummary: card?.liquiditySummary ?? "",
      keyLevelsSummary: card?.keyLevelsSummary ?? "",
      headline: buildHeadline(symbol, mapDirection(card?.direction), card?.setupType ?? "monitored setup", displayCategory),
      summary: buildSummary(resolvedInput, card?.shortReasoning ?? "", card?.noTradeExplanation ?? null),
      reason_labels: buildReasonLabels(resolvedInput, riskRuleCodes),
      confidence_label: buildConfidenceLabel(card?.confidence ?? 0, grade),
      ui_sections: {},
      commentary: card
        ? {
          short_reasoning: card.shortReasoning,
          detailed_reasoning: card.detailedReasoning,
        }
        : null,
      ui_version: "signal_view_model_v4",
      assetClass: resolveAssetClassLabel(resolvedInput),
      providerStatus: dataTrust.providerStatus,
      priceSource: dataTrust.priceSource,
      candleSource: dataTrust.candleSource,
      fallbackDepth: dataTrust.fallbackDepth,
      dataFreshnessMs: dataTrust.dataFreshnessMs,
      missingBarCount: dataTrust.missingBarCount,
      lastSuccessfulProvider: dataTrust.lastSuccessfulProvider,
      quoteIntegrity: dataTrust.quoteIntegrity,
      universeMembershipConfidence: dataTrust.universeMembershipConfidence,
      dataTrustScore: dataTrust.dataTrustScore,
      qualityScores,
      publicationStatus: publication.status,
      publicationReasons: publication.reasons,
      moduleHealth: publication.health,
      healthFlags: buildHealthFlags({
        providerStatus: dataTrust.providerStatus,
        publicationStatus: publication.status,
        dataTrustScore: dataTrust.dataTrustScore,
        reasons: publication.reasons,
      }),
    };

    const persistedModel = {
      ...model,
      ui_sections: undefined,
      commentary: model.commentary,
    };

    model.ui_sections = {
      model: persistedModel,
      refs: {
        snapshot_id: input.snapshot?.snapshot_id ?? null,
        candidate_id: input.candidate?.candidate_id ?? null,
        signal_id: input.signal?.signal_id ?? null,
      },
      health: {
        assetClass: model.assetClass,
        providerStatus: model.providerStatus,
        priceSource: model.priceSource,
        candleSource: model.candleSource,
        fallbackDepth: model.fallbackDepth,
        dataFreshnessMs: model.dataFreshnessMs,
        missingBarCount: model.missingBarCount,
        dataTrustScore: model.dataTrustScore,
        publicationStatus: model.publicationStatus,
        publicationReasons: model.publicationReasons,
        moduleHealth: model.moduleHealth,
        qualityScores: model.qualityScores,
        healthFlags: model.healthFlags,
      },
      legacy: {
        live_market: state.liveMarket,
        key_areas: state.keyAreas,
        diagnostics: state.diagnostics,
      },
    };

    return model;
  }

  static buildFromCycleOutput(
    output: CycleOutput,
    livePrices: Record<string, number | null>,
  ): SignalViewModel[] {
    return output.signals
      .map(signal => {
        const candidate = output.candidates.find(item => item.candidate_id === signal.candidate_id) ?? null;
        const snapshot = candidate
          ? output.snapshots.find(item => item.snapshot_id === candidate.snapshot_id) ?? null
          : output.snapshots.find(item => item.symbol === signal.symbol) ?? null;
        const risk = candidate
          ? output.risk_results.find(item => item.candidate_id === candidate.candidate_id) ?? null
          : null;

        const model = SignalViewModelBuilder.build({
          snapshot,
          candidate,
          risk,
          signal,
          lifecycle: null,
        });
        if (!model) {
          return null;
        }

        return {
          ...model,
          livePrice: livePrices[model.symbol] ?? model.livePrice ?? null,
        };
      })
      .filter((model): model is SignalViewModel => model != null);
  }

  static hydratePersistedViewModel(input: {
    viewId: string;
    entityRef: string;
    displayType: SignalViewDisplayType;
    headline: string;
    summary: string;
    reasonLabels: string[];
    confidenceLabel: string | null;
    uiSections: Record<string, unknown>;
    commentary: Record<string, unknown> | null;
    uiVersion: string;
    generatedAt: number;
    livePrice?: number | null;
  }): SignalViewModel {
    const persisted = asRecord(input.uiSections.model);
    if (persisted.symbol) {
      return fromPersistedModel(persisted, input.livePrice);
    }

    return buildFallbackPersistedViewModel(input);
  }
}

export function buildViewModel(input: BuildViewModelInput): SignalViewModel | null {
  return SignalViewModelBuilder.buildFromRuntimeState(input);
}

export function classifyDisplayType(input: BuildViewModelInput): SignalViewDisplayType {
  const model = SignalViewModelBuilder.buildFromRuntimeState(input);
  return model?.displayCategory ?? "monitored";
}
