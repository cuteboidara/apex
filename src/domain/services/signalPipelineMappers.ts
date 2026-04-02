import { createId } from "@/src/lib/ids";
import type {
  AllocationIntent,
  FeatureSnapshot,
  PairMarketDataDiagnostics,
  PodEvaluation,
  SignalLifecycleRecord,
} from "@/src/interfaces/contracts";
import { aggregatePodVotes } from "@/src/domain/pods/aggregatePodVotes";
import { identityAdapter } from "@/src/domain/pods/podAdapters";
import { isCalibratedPodConfidenceEnabled } from "@/src/domain/pods/confidenceNormalization";
import type { PodVote } from "@/src/domain/pods/types";
import { buildViewModel } from "@/src/domain/services/viewModelBuilder";
import {
  buildFxSnapshotDataTrust,
  buildPublicationState,
  buildQualityScores,
  summarizeStageDiagnostics,
} from "@/src/domain/services/signalTrust";
import {
  type CycleOutput,
  type CyclePipelineStatus,
  type ExecutableSignal,
  type ExecutableSignalInput,
  type MarketSnapshot,
  type MarketSnapshotInput,
  type RiskEvaluatedCandidate,
  type RiskEvaluatedCandidateInput,
  SIGNAL_PIPELINE_VERSIONS,
  type SignalLifecycle,
  type SignalViewModel,
  type SignalViewModelInput,
  type TradeCandidate,
  type TradeCandidateInput,
} from "@/src/domain/models/signalPipeline";
import type { SignalAssetClass } from "@/src/domain/models/signalHealth";

function resolveDataQualityTier(
  snapshot: FeatureSnapshot,
  marketData: PairMarketDataDiagnostics | null,
): MarketSnapshot["data_quality_tier"] {
  if (marketData?.sourceMode === "synthetic" || snapshot.context.quality_flag === "synthetic") {
    return "synthetic";
  }
  if (
    marketData?.sourceMode === "cache"
    || marketData?.usedFallback
    || marketData?.qualityFlag != null && marketData.qualityFlag !== "clean"
    || snapshot.quality.confidence < 0.8
    || snapshot.quality.completeness < 0.95
  ) {
    return "degraded";
  }
  return "high";
}

function resolveLifecycleFillStatus(record: SignalLifecycleRecord): SignalLifecycle["fill_status"] {
  if (record.state === "cancelled") {
    return "cancelled";
  }
  if (["tp3_hit", "stopped_out", "expired"].includes(record.state)) {
    return "closed";
  }
  if (["activated", "tp1_hit", "tp2_hit"].includes(record.state)) {
    return "open";
  }
  return "pending";
}

function resolveAssetClass(symbol: string): SignalAssetClass {
  if (symbol.endsWith("USD") && symbol.length === 6) {
    return "fx";
  }
  return "fx";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function resolveStructureQuality(snapshot: MarketSnapshot): number {
  const features = asRecord(snapshot.features);
  const smcAnalysis = asRecord(features.smcAnalysis);
  const smcScore = asRecord(smcAnalysis.smcScore).total;
  if (typeof smcScore === "number") {
    return smcScore;
  }
  const quality = asRecord(asRecord(snapshot.raw_inputs_metadata).quality);
  const confidence = quality.confidence;
  if (typeof confidence === "number") {
    return Math.round(confidence * 100);
  }
  return 60;
}

function resolveMarketQuality(snapshot: MarketSnapshot): number {
  const metadata = asRecord(snapshot.raw_inputs_metadata);
  const marketData = asRecord(metadata.market_data);
  let score = 70;

  if (typeof marketData.candlesFetched === "number" && marketData.candlesFetched < 32) {
    score -= 12;
  }
  if (marketData.qualityFlag && marketData.qualityFlag !== "clean") {
    score -= 10;
  }
  if (marketData.usedFallback === true) {
    score -= 8;
  }
  if (typeof snapshot.data_freshness_ms === "number" && snapshot.data_freshness_ms > 15 * 60 * 1000) {
    score -= 10;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function resolveExecutionQuality(candidate: AllocationIntent): number {
  const tradePlan = candidate.trade_plan;
  if (!tradePlan) {
    return 20;
  }

  let score = 60;
  if ((tradePlan.risk_reward_ratio ?? 0) >= 2) {
    score += 15;
  } else if ((tradePlan.risk_reward_ratio ?? 0) >= 1.5) {
    score += 8;
  }
  if (tradePlan.entry != null && tradePlan.sl != null && tradePlan.tp1 != null) {
    score += 10;
  }
  if (candidate.entry_style === "trend_pullback" || candidate.entry_style === "session_breakout") {
    score += 5;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

function resolveAssetFitScore(candidate: AllocationIntent): number {
  if (candidate.entry_style === "trend_pullback" || candidate.entry_style === "session_breakout") {
    return 86;
  }
  if (candidate.entry_style === "range_reversal") {
    return 78;
  }
  return 72;
}

function resolveLivePrice(snapshot: MarketSnapshot): number | null {
  const features = asRecord(snapshot.features);
  if (typeof features.mid === "number" && Number.isFinite(features.mid)) {
    return features.mid;
  }
  if (typeof features.close === "number" && Number.isFinite(features.close)) {
    return features.close;
  }
  return null;
}

function normalizeFinitePrice(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasDirectionalIntent(candidate: AllocationIntent): boolean {
  return candidate.direction === "buy" || candidate.direction === "sell";
}

function resolveCanonicalLivePrice(input: {
  snapshot?: MarketSnapshot | null;
  candidate: AllocationIntent;
  approvedTradePlan?: AllocationIntent["trade_plan"] | null;
}): number | null {
  return normalizeFinitePrice(input.approvedTradePlan?.entry)
    ?? normalizeFinitePrice(input.candidate.trade_plan?.entry)
    ?? normalizeFinitePrice(input.candidate.entry)
    ?? (input.snapshot ? resolveLivePrice(input.snapshot) : null);
}

function resolvePublicationRiskStatus(
  candidate: AllocationIntent,
  decision: "approved" | "modified" | "blocked",
): "approved" | "rejected" | "deferred" | "reduced" {
  if (!hasDirectionalIntent(candidate)) {
    return "deferred";
  }
  if (decision === "blocked") {
    return "rejected";
  }
  if (decision === "modified") {
    return "reduced";
  }
  return "approved";
}

function resolvePublicationNoTradeReason(
  candidate: AllocationIntent,
  decision: "approved" | "modified" | "blocked",
): string | null {
  if (!hasDirectionalIntent(candidate)) {
    return "no structure";
  }
  return decision === "blocked" ? "blocked by risk" : null;
}

function resolveDataTrust(snapshot: MarketSnapshot): number {
  return snapshot.data_trust_score ?? snapshot.data_health?.dataTrustScore ?? 0;
}

export function toMarketSnapshot(input: MarketSnapshotInput): MarketSnapshot {
  const dataTrust = buildFxSnapshotDataTrust({
    marketData: input.market_data,
    snapshotTimestamp: input.snapshot.ts,
    snapshotQualityConfidence: input.snapshot.quality.confidence,
  });
  return {
    snapshot_id: input.snapshot.snapshot_id,
    cycle_id: input.cycle_id,
    symbol: input.snapshot.symbol_canonical,
    timestamp: input.snapshot.ts,
    features: {
      ...input.snapshot.features,
      smcAnalysis: input.snapshot.smcAnalysis ?? null,
    },
    raw_inputs_metadata: {
      market_data: input.market_data,
      quality: input.snapshot.quality,
    },
    data_source: input.market_data?.provider ?? input.snapshot.context.source,
    data_quality_tier: resolveDataQualityTier(input.snapshot, input.market_data),
    feature_version: SIGNAL_PIPELINE_VERSIONS.market_snapshot,
    market_session_context: {
      session: input.snapshot.context.session.session,
      trading_day: input.snapshot.context.session.tradingDay,
      hour_bucket: input.snapshot.context.session.hourBucket,
      minutes_since_session_open: input.snapshot.context.session.minutesSinceSessionOpen,
    },
    publication_session_window: input.snapshot.context.session.session,
    session_context: input.snapshot.context,
    created_at: Date.now(),
    data_fetch_timestamps: [
      input.snapshot.ts,
      input.market_data?.lastCandleTimestamp ?? input.snapshot.ts,
    ].filter((value): value is number => value != null),
    asset_class: resolveAssetClass(input.snapshot.symbol_canonical),
    provider_status: dataTrust.providerStatus,
    price_source: dataTrust.priceSource,
    candle_source: dataTrust.candleSource,
    fallback_depth: dataTrust.fallbackDepth,
    data_freshness_ms: dataTrust.dataFreshnessMs,
    missing_bar_count: dataTrust.missingBarCount,
    last_successful_provider: dataTrust.lastSuccessfulProvider,
    quote_integrity: dataTrust.quoteIntegrity,
    universe_membership_confidence: dataTrust.universeMembershipConfidence,
    data_trust_score: dataTrust.dataTrustScore,
    data_health: dataTrust,
  };
}

export function toTradeCandidate(input: TradeCandidateInput): TradeCandidate {
  const podVotes = input.pod_votes ?? input.pod_outputs.map(output => identityAdapter({
    ...(output as PodEvaluation & PodVote),
    weight: input.candidate.pod_weights[output.pod_id] ?? (output as PodEvaluation & PodVote).weight,
  }));
  const aggregatedDecision = input.aggregated_pod_decision ?? aggregatePodVotes(podVotes);
  const calibratedConfidenceEnabled = isCalibratedPodConfidenceEnabled();
  const qualityScores = buildQualityScores({
    structure: resolveStructureQuality(input.snapshot),
    market: resolveMarketQuality(input.snapshot),
    execution: resolveExecutionQuality(input.candidate),
    data: resolveDataTrust(input.snapshot),
    assetFit: resolveAssetFitScore(input.candidate),
  });
  const publication = buildPublicationState({
    providerStatus: input.snapshot.provider_status ?? "broken",
    livePrice: resolveLivePrice(input.snapshot),
    quoteIntegrity: input.snapshot.quote_integrity ?? false,
    dataTrustScore: resolveDataTrust(input.snapshot),
    qualityScores,
    noTradeReason: input.candidate.direction === "none" ? "no structure" : null,
    blockedReasons: input.candidate.veto_reasons,
    forceWatchlist: input.candidate.direction === "none",
  });

  return {
    candidate_id: input.candidate.candidate_id,
    cycle_id: input.cycle_id,
    snapshot_id: input.snapshot.snapshot_id,
    symbol: input.candidate.symbol_canonical,
    direction: input.candidate.direction,
    confidence: input.candidate.confidence,
    size_hint: Math.abs(input.candidate.target_position),
    allocator_version: SIGNAL_PIPELINE_VERSIONS.trade_candidate,
    pod_votes: podVotes,
    supporting_evidence: {
      reasoning: input.candidate.reasoning,
      reason_codes: input.candidate.reason_codes,
      veto_reasons: input.candidate.veto_reasons,
      portfolio_context: input.candidate.portfolio_context,
      session: input.candidate.session,
      regime: input.candidate.regime,
      entry_style: input.candidate.entry_style,
    },
    allocator_metadata: {
      aggregated_pod_direction: aggregatedDecision.direction,
      selected_pods: input.candidate.selected_pods,
      entry_style: input.candidate.entry_style,
      session: input.candidate.session,
      regime: input.candidate.regime,
      target_position: input.candidate.target_position,
      candidate_reason_codes: input.candidate.reason_codes,
      calibrated_confidence_enabled: calibratedConfidenceEnabled,
      calibrated_confidence_applied: false,
    },
    directional_attribution: {
      long_score: aggregatedDecision.directional_support.long_score,
      short_score: aggregatedDecision.directional_support.short_score,
      neutral_score: aggregatedDecision.directional_support.neutral_score,
      long_contributors: aggregatedDecision.attribution.long_contributors,
      short_contributors: aggregatedDecision.attribution.short_contributors,
      regime_contributors: aggregatedDecision.attribution.regime_contributors,
    },
    veto_attribution: {
      vetoes: aggregatedDecision.veto_details,
      veto_contributors: aggregatedDecision.attribution.veto_contributors,
    },
    confidence_breakdown: {
      legacy_confidence: input.candidate.confidence,
      raw_aggregate_confidence: aggregatedDecision.contributing_pods.length === 0
        ? 0
        : aggregatedDecision.contributing_pods.reduce((sum, vote) => sum + (vote.rawConfidence ?? vote.raw_confidence ?? vote.confidence), 0)
          / aggregatedDecision.contributing_pods.length,
      normalized_aggregate_confidence: aggregatedDecision.confidence,
      calibrated_confidence_enabled: calibratedConfidenceEnabled,
      calibrated_confidence_applied: false,
    },
    proposed_trade_plan: input.candidate.trade_plan,
    status: "proposed",
    created_at: Date.now(),
    quality_scores: qualityScores,
    publication_status: publication.status,
    publication_reasons: publication.reasons,
    module_health: publication.health,
  };
}

export function toRiskEvaluatedCandidate(input: RiskEvaluatedCandidateInput): RiskEvaluatedCandidate {
  if (input.risk_evaluation) {
    const publicationRiskStatus = resolvePublicationRiskStatus(input.candidate, input.risk_evaluation.decision);
    const existingQualityScores = buildQualityScores({
      structure: input.candidate.confidence * 100,
      market: input.risk_evaluation.decision === "blocked" ? 25 : 72,
      execution: input.risk_evaluation.approved_trade_plan ? 78 : 18,
      data: 78,
      assetFit: 84,
    });
    const publication = buildPublicationState({
      providerStatus: "healthy",
      livePrice: resolveCanonicalLivePrice({
        snapshot: input.snapshot,
        candidate: input.candidate,
        approvedTradePlan: input.risk_evaluation.approved_trade_plan,
      }),
      quoteIntegrity: true,
      dataTrustScore: existingQualityScores.data,
      qualityScores: existingQualityScores,
      noTradeReason: resolvePublicationNoTradeReason(input.candidate, input.risk_evaluation.decision),
      riskStatus: publicationRiskStatus,
      blockedReasons: publicationRiskStatus === "deferred" ? [] : input.risk_evaluation.blocking_rules,
      forceWatchlist: publicationRiskStatus === "deferred",
    });
    return {
      candidate_id: input.candidate.candidate_id,
      cycle_id: input.cycle_id,
      decision: input.risk_evaluation.decision,
      blocking_rules: input.risk_evaluation.blocking_rules,
      warnings: input.risk_evaluation.warnings,
      size_adjustments: input.risk_evaluation.size_adjustments,
      policy_evaluations: input.risk_evaluation.policy_evaluations,
      risk_version: input.risk_evaluation.risk_version,
      approved_trade_plan: input.risk_evaluation.approved_trade_plan,
      authoritative_source: input.risk_evaluation.authoritative_source,
      shadow_decision: input.risk_evaluation.shadow_decision,
      shadow_mismatch: input.risk_evaluation.shadow_mismatch,
      shadow_blocking_rules: input.risk_evaluation.shadow_blocking_rules,
      shadow_adjustments: input.risk_evaluation.shadow_adjustments,
      explainability_score: input.risk_evaluation.explainability_score,
      created_at: Date.now(),
      quality_scores: existingQualityScores,
      publication_status: publication.status,
      publication_reasons: publication.reasons,
      module_health: publication.health,
    };
  }

  const originalSize = Math.abs(input.candidate.target_position);
  const approvedSizeMultiplier = input.risk_decision.approved_size_multiplier ?? 1;
  const approvedSize = originalSize * approvedSizeMultiplier;
  const decision = input.risk_decision.approval_status === "approved"
    ? "approved"
    : input.risk_decision.approval_status === "approved_reduced"
      ? "modified"
      : "blocked";
  const publicationRiskStatus = resolvePublicationRiskStatus(input.candidate, decision);
  const blockingRules = [...(input.risk_decision.veto_reasons ?? [])];
  const warningReasons = [...(input.risk_decision.warning_reasons ?? [])];
  const qualityScores = buildQualityScores({
    structure: input.candidate.confidence * 100,
    market: decision === "blocked" ? 24 : 70,
    execution: decision === "blocked" ? 18 : approvedSizeMultiplier < 1 ? 62 : 78,
    data: 78,
    assetFit: 84,
  });
  const publication = buildPublicationState({
    providerStatus: "healthy",
    livePrice: resolveCanonicalLivePrice({
      snapshot: input.snapshot,
      candidate: input.candidate,
      approvedTradePlan: decision === "blocked" ? null : input.candidate.trade_plan,
    }),
    quoteIntegrity: true,
    dataTrustScore: qualityScores.data,
    qualityScores,
    noTradeReason: resolvePublicationNoTradeReason(input.candidate, decision),
    riskStatus: publicationRiskStatus,
    blockedReasons: publicationRiskStatus === "deferred" ? [] : blockingRules,
    forceWatchlist: publicationRiskStatus === "deferred",
  });

  return {
    candidate_id: input.candidate.candidate_id,
    cycle_id: input.cycle_id,
    decision,
    blocking_rules: blockingRules,
    warnings: warningReasons,
    size_adjustments: decision === "modified" || approvedSizeMultiplier !== 1
      ? {
        original_size: originalSize,
        approved_size: approvedSize,
        approved_size_multiplier: approvedSizeMultiplier,
      }
      : null,
    policy_evaluations: [{
      module_name: "legacy_risk_parity",
      module_version: "fallback",
      decision: decision === "blocked" ? "block" : decision === "modified" ? "modify" : "pass",
      blocking_rules: blockingRules.map(rule => ({
        rule_code: rule,
        reason: rule,
      })),
      warnings: warningReasons.map(rule => ({
        warning_code: rule,
        reason: rule,
      })),
      adjustments: decision === "modified" ? [{
        adjustment_code: "legacy.approved_size_multiplier",
        field: "approved_size_multiplier",
        before: 1,
        after: approvedSizeMultiplier,
        reason: "legacy fallback size reduction",
      }] : [],
      metadata: {
        risk_check_results: input.risk_decision.risk_check_results,
        kill_switch_active: input.risk_decision.kill_switch_active,
        override_instructions: input.risk_decision.override_instructions ?? null,
      },
    }],
    risk_version: SIGNAL_PIPELINE_VERSIONS.risk_evaluated_candidate,
    approved_trade_plan: decision === "blocked" ? null : input.candidate.trade_plan,
    authoritative_source: "legacy_risk_parity",
    shadow_decision: null,
    shadow_mismatch: false,
    shadow_blocking_rules: [],
    shadow_adjustments: [],
    explainability_score: null,
    created_at: Date.now(),
    quality_scores: qualityScores,
    publication_status: publication.status,
    publication_reasons: publication.reasons,
    module_health: publication.health,
  };
}

export function toExecutableSignal(input: ExecutableSignalInput): ExecutableSignal | null {
  if (input.risk_evaluated_candidate.decision === "blocked") {
    return null;
  }
  if (input.candidate.direction !== "buy" && input.candidate.direction !== "sell") {
    return null;
  }
  if (!input.risk_evaluated_candidate.approved_trade_plan) {
    return null;
  }

  const qualityScores = input.risk_evaluated_candidate.quality_scores ?? buildQualityScores({
    structure: input.candidate.confidence * 100,
    market: 75,
    execution: 82,
    data: 80,
    assetFit: 84,
  });
  const publication = buildPublicationState({
    providerStatus: "healthy",
    livePrice: resolveCanonicalLivePrice({
      snapshot: input.snapshot,
      candidate: input.candidate,
      approvedTradePlan: input.risk_evaluated_candidate.approved_trade_plan,
    }),
    quoteIntegrity: true,
    dataTrustScore: qualityScores.data,
    qualityScores,
    riskStatus: input.risk_evaluated_candidate.decision === "modified" ? "reduced" : "approved",
  });

  return {
    signal_id: createId("signal"),
    cycle_id: input.cycle_id,
    candidate_id: input.candidate.candidate_id,
    symbol: input.candidate.symbol_canonical,
    direction: input.candidate.direction,
    size: Math.abs(input.candidate.target_position) * (input.risk_evaluated_candidate.size_adjustments?.approved_size_multiplier ?? 1),
    entry: input.risk_evaluated_candidate.approved_trade_plan.entry,
    stop_loss: input.risk_evaluated_candidate.approved_trade_plan.sl,
    take_profit: {
      tp1: input.risk_evaluated_candidate.approved_trade_plan.tp1,
      tp2: input.risk_evaluated_candidate.approved_trade_plan.tp2,
      tp3: input.risk_evaluated_candidate.approved_trade_plan.tp3,
    },
    status: input.lifecycle?.state ?? "signal_created",
    created_at: Date.now(),
    version: SIGNAL_PIPELINE_VERSIONS.executable_signal,
    quality_scores: qualityScores,
    publication_status: publication.status,
    publication_reasons: publication.reasons,
    module_health: publication.health,
  };
}

export function toCanonicalSignalLifecycle(
  record: SignalLifecycleRecord,
  signalId = record.signal_id,
): SignalLifecycle {
  return {
    signal_id: signalId,
    current_state: record.state,
    fill_status: resolveLifecycleFillStatus(record),
    opened_at: record.activated_ts ?? null,
    updated_at: record.updated_ts,
    closed_at: record.completed_ts ?? null,
    pnl: null,
    execution_events: record.events,
  };
}

export function toSignalViewModel(input: SignalViewModelInput): SignalViewModel | null {
  return buildViewModel({
    state: input.state,
    snapshot: input.snapshot,
    candidate: input.candidate,
    risk: input.risk_result,
    signal: input.executable_signal,
    lifecycle: null,
  });
}

export function buildCycleOutput(input: {
  cycle_id: string;
  started_at: number;
  completed_at: number;
  symbols_processed: string[];
  snapshots: MarketSnapshot[];
  candidates: TradeCandidate[];
  risk_results: RiskEvaluatedCandidate[];
  signals: ExecutableSignal[];
  view_models: SignalViewModel[];
  metadata?: Record<string, unknown>;
  pipeline_status: CyclePipelineStatus;
}): CycleOutput {
  const podVersions = input.candidates.reduce<Record<string, string>>((acc, candidate) => {
    for (const pod of candidate.pod_votes) {
      acc[pod.podName ?? pod.pod_name ?? "unknown"] = pod.version ?? pod.pod_version ?? "unknown";
    }
    return acc;
  }, {});

  return {
    cycle_id: input.cycle_id,
    started_at: input.started_at,
    completed_at: input.completed_at,
    symbols_processed: [...input.symbols_processed],
    snapshots: input.snapshots,
    candidates: input.candidates,
    risk_results: input.risk_results,
    signals: input.signals,
    metadata: {
      ...input.metadata,
      pipeline_diagnostics: summarizeStageDiagnostics({
        cycleId: input.cycle_id,
        startedAt: input.started_at,
        completedAt: input.completed_at,
        symbolsProcessed: input.symbols_processed,
        snapshots: input.snapshots,
        candidates: input.candidates,
        riskResults: input.risk_results,
        signals: input.signals,
        viewModels: input.view_models,
      }),
      view_models: input.view_models.map(view => ({
        view_id: view.view_id,
        entity_ref: view.entity_ref,
        display_type: view.display_type,
        publication_status: view.publicationStatus ?? null,
        provider_status: view.providerStatus ?? null,
      })),
    },
    versions: {
      feature_version: SIGNAL_PIPELINE_VERSIONS.market_snapshot,
      pod_versions: podVersions,
      allocator_version: SIGNAL_PIPELINE_VERSIONS.trade_candidate,
      risk_version: SIGNAL_PIPELINE_VERSIONS.risk_evaluated_candidate,
      trade_plan_version: SIGNAL_PIPELINE_VERSIONS.trade_plan,
      view_model_version: SIGNAL_PIPELINE_VERSIONS.signal_view_model,
      llm_prompt_version: null,
      data_source: [...new Set(input.snapshots.map(snapshot => snapshot.data_source))],
      data_fetch_timestamps: input.snapshots.flatMap(snapshot => snapshot.data_fetch_timestamps),
    },
    pipeline_status: input.pipeline_status,
    payload_source: "canonical",
  };
}

export function buildReconstructedCycleOutput(input: {
  cycle_id: string;
  started_at: number;
  completed_at: number;
  symbols_processed: string[];
  metadata?: Record<string, unknown>;
}): CycleOutput {
  return buildCycleOutput({
    ...input,
    snapshots: [],
    candidates: [],
    risk_results: [],
    signals: [],
    view_models: [],
    metadata: {
      reconstruction_reason: "canonical_cycle_output_unavailable",
      reconstructed_at: input.completed_at,
      ...input.metadata,
    },
    pipeline_status: "failed",
  });
}
