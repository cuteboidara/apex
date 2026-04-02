import assert from "node:assert/strict";
import test from "node:test";

import type {
  CycleOutput,
  ExecutableSignal,
  MarketSnapshot,
  RiskEvaluatedCandidate,
  SignalLifecycle,
  SignalViewModel,
  TradeCandidate,
} from "@/src/domain/models/signalPipeline";
import { buildViewModel, classifyDisplayType } from "@/src/domain/services/viewModelBuilder";
import { createEmptySignalsPayload, reconstructSignalsPayloadForRuntime } from "@/src/domain/services/reconstructionService";
import { getCanonicalSignalsPayload } from "@/src/api/signals";

function makeSnapshot(symbol = "EURUSD"): MarketSnapshot {
  return {
    snapshot_id: `snapshot_${symbol}`,
    cycle_id: "cycle_1",
    symbol,
    timestamp: 1_710_000_000_000,
    features: {
      mid: 1.0845,
    },
    raw_inputs_metadata: {
      market_data: {
        symbol,
        interval: "15min",
        provider: "oanda",
        candlesFetched: 64,
        lastCandleTimestamp: 1_710_000_000_000,
        latencyMs: 100,
        sourceMode: "live",
        usedFallback: false,
        qualityFlag: "clean",
        unavailableReason: null,
      },
      quality: {
        staleness_ms: 0,
        completeness: 1,
        confidence: 1,
      },
    },
    data_source: "oanda",
    data_quality_tier: "high",
    feature_version: "market_snapshot_v1",
    market_session_context: {
      session: "london",
      trading_day: "2026-03-27",
      hour_bucket: 9,
      minutes_since_session_open: 120,
    },
    publication_session_window: "london",
    session_context: {
      timeframe: "15m",
      source: "oanda",
      quality_flag: "clean",
      session: {
        session: "london",
        tradingDay: "2026-03-27",
        hourBucket: 9,
        minutesSinceSessionOpen: 120,
      },
      economic_event: {
        majorNewsFlag: false,
        minutesToNextHighImpactEvent: null,
        minutesSinceLastHighImpactEvent: null,
        eventType: null,
      },
    },
    created_at: 1_710_000_000_100,
    data_fetch_timestamps: [1_710_000_000_000],
  };
}

function makeCandidate(symbol = "EURUSD"): TradeCandidate {
  return {
    candidate_id: `candidate_${symbol}`,
    cycle_id: "cycle_1",
    snapshot_id: `snapshot_${symbol}`,
    symbol,
    direction: "buy",
    confidence: 0.82,
    size_hint: 0.15,
    allocator_version: "trade_candidate_v1",
    pod_votes: [],
    supporting_evidence: {
      regime: "trend",
      entry_style: "trend_pullback",
      reasoning: ["Bullish structure remains intact."],
      reason_codes: [],
      veto_reasons: [],
      portfolio_context: {
        gross_exposure: 0,
        net_exposure: 0,
        active_symbols: 0,
      },
    },
    allocator_metadata: {
      aggregated_pod_direction: "long",
      selected_pods: [],
      calibrated_confidence_enabled: false,
      calibrated_confidence_applied: false,
    },
    directional_attribution: {
      long_score: 0,
      short_score: 0,
      neutral_score: 0,
      long_contributors: [],
      short_contributors: [],
      regime_contributors: [],
    },
    veto_attribution: {
      vetoes: [],
      veto_contributors: [],
    },
    confidence_breakdown: {
      legacy_confidence: 0.82,
      raw_aggregate_confidence: 0.82,
      normalized_aggregate_confidence: 0.82,
      calibrated_confidence_enabled: false,
      calibrated_confidence_applied: false,
    },
    proposed_trade_plan: {
      entry: 1.0845,
      sl: 1.0815,
      tp1: 1.09,
      tp2: 1.092,
      tp3: 1.094,
      risk_reward_ratio: 1.83,
      entry_zone: {
        low: 1.084,
        high: 1.085,
        label: "Pullback zone",
      },
      invalidation_zone: {
        low: 1.081,
        high: 1.082,
        label: "Invalidation",
      },
      pre_entry_invalidation: "Cancel if structure breaks before entry.",
      post_entry_invalidation: "Exit if invalidation breaks after entry.",
      expires_after_bars: 3,
      expires_at: 1_710_000_100_000,
    },
    status: "proposed",
    created_at: 1_710_000_000_200,
  };
}

function makeRisk(candidateId = "candidate_EURUSD", decision: RiskEvaluatedCandidate["decision"] = "approved"): RiskEvaluatedCandidate {
  return {
    candidate_id: candidateId,
    cycle_id: "cycle_1",
    decision,
    blocking_rules: decision === "blocked" ? ["NEWS_LOCK"] : [],
    warnings: [],
    size_adjustments: null,
    policy_evaluations: [],
    risk_version: "risk_evaluated_candidate_v1",
    approved_trade_plan: decision === "blocked" ? null : makeCandidate().proposed_trade_plan,
    authoritative_source: "legacy_risk_parity",
    shadow_decision: decision,
    shadow_mismatch: false,
    shadow_blocking_rules: decision === "blocked" ? ["market.news_lock"] : [],
    shadow_adjustments: [],
    explainability_score: 1,
    created_at: 1_710_000_000_300,
  };
}

function makeSignal(candidateId = "candidate_EURUSD"): ExecutableSignal {
  return {
    signal_id: "signal_EURUSD",
    cycle_id: "cycle_1",
    candidate_id: candidateId,
    symbol: "EURUSD",
    direction: "buy",
    size: 0.15,
    entry: 1.0845,
    stop_loss: 1.0815,
    take_profit: {
      tp1: 1.09,
      tp2: 1.092,
      tp3: 1.094,
    },
    status: "signal_created",
    created_at: 1_710_000_000_400,
    version: "executable_signal_v1",
  };
}

function makeLifecycle(signalId = "signal_EURUSD"): SignalLifecycle {
  return {
    signal_id: signalId,
    current_state: "signal_created",
    fill_status: "pending",
    opened_at: null,
    updated_at: 1_710_000_000_500,
    closed_at: null,
    pnl: null,
    execution_events: [],
  };
}

test("view model is derived from canonical inputs only", () => {
  const snapshot = makeSnapshot();
  const candidate = makeCandidate();
  const risk = makeRisk(candidate.candidate_id, "blocked");

  const viewModel = buildViewModel({
    snapshot,
    candidate,
    risk,
    signal: null,
    lifecycle: null,
  });

  assert.ok(viewModel);
  assert.equal(viewModel?.display_type, "rejected");
  assert.equal(classifyDisplayType({
    snapshot,
    candidate,
    risk,
    signal: null,
    lifecycle: null,
  }), "rejected");
});

test("canonical signals payload uses canonical persisted truth and preserves compatibility payload", async () => {
  const snapshot = makeSnapshot();
  const candidate = makeCandidate();
  const risk = makeRisk(candidate.candidate_id, "approved");
  const signal = makeSignal(candidate.candidate_id);
  const lifecycle = makeLifecycle(signal.signal_id);
  const viewModel: SignalViewModel = buildViewModel({
    snapshot,
    candidate,
    risk,
    signal,
    lifecycle,
  })!;
  const cycleOutput: CycleOutput = {
    cycle_id: "cycle_1",
    started_at: 1_710_000_000_000,
    completed_at: 1_710_000_001_000,
    symbols_processed: ["EURUSD"],
    snapshots: [snapshot],
    candidates: [candidate],
    risk_results: [risk],
    signals: [signal],
    metadata: {},
    versions: {
      feature_version: "market_snapshot_v1",
      pod_versions: {},
      allocator_version: "trade_candidate_v1",
      risk_version: "risk_evaluated_candidate_v1",
      trade_plan_version: "trade_plan_v1",
      view_model_version: "signal_view_model_v2",
      llm_prompt_version: null,
      data_source: ["oanda"],
      data_fetch_timestamps: [snapshot.timestamp],
    },
    pipeline_status: "completed",
    payload_source: "canonical",
  };

  const payload = await getCanonicalSignalsPayload({
    readCanonicalBundle: async () => ({
      cycleOutput,
      viewModels: [viewModel],
      lifecycles: new Map([[signal.signal_id, lifecycle]]),
    }),
    buildCompatibilityPayload: async () => ({
      ...createEmptySignalsPayload(),
      generatedAt: cycleOutput.completed_at,
      liveMarketBoard: [{
        symbol: "EURUSD",
        livePrice: 1.0845,
        session: "London",
        bias: "bullish",
        grade: "B",
        noTradeReason: null,
        marketStateLabels: ["active session"],
        status: "active",
      }],
    }),
  });

  assert.equal(payload.payload_source, "canonical");
  assert.equal(payload.cycle_id, "cycle_1");
  assert.equal(payload.signals.length, 1);
  assert.equal(payload.signals[0]?.signal_id, "signal_EURUSD");
  assert.equal(payload.signals[0]?.display_type, "executable");
  assert.equal(payload.liveMarketBoard.length, 8);
  assert.equal(payload.liveMarketBoard.find(row => row.symbol === "EURUSD")?.status, "active");
  assert.ok(payload.pipelineDiagnostics);
  assert.equal((payload.pipelineDiagnostics?.stageCounts as Record<string, number>)?.marketSnapshotCount, 1);
});

test("canonical signals payload fails explicitly when canonical truth is missing", async () => {
  await assert.rejects(
    () => getCanonicalSignalsPayload({
      readCanonicalBundle: async () => {
        throw new Error("CANONICAL_TRUTH_MISSING");
      },
    }),
    /CANONICAL_TRUTH_MISSING/,
  );
});

test("reconstruction is disabled outside debug mode", async () => {
  await assert.rejects(
    () => reconstructSignalsPayloadForRuntime({
      config: {
        activeSymbols: ["EURUSD"],
        marketScope: {},
        showBlockedSignalsOnMainDashboard: false,
        showAdvancedInternals: false,
        pairProfiles: {},
      },
      repository: {
        getLatestFeatureSnapshots: () => [],
        getLatestSignalCandidates: () => [],
        getRecentRiskDecisions: () => [],
        getSignalLifecycles: () => [],
      },
    }),
    /RECONSTRUCTION_NOT_ALLOWED/,
  );
});
