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
import { SignalViewModelBuilder } from "@/src/domain/services/viewModelBuilder";
import type { TraderPairRuntimeState } from "@/src/lib/traderContracts";

function makeSnapshot(symbol = "EURUSD"): MarketSnapshot {
  return {
    snapshot_id: `snapshot_${symbol}`,
    cycle_id: "cycle_1",
    symbol,
    timestamp: 1_710_000_000_000,
    features: { mid: 1.0845 },
    raw_inputs_metadata: {},
    data_source: "oanda",
    data_quality_tier: "high",
    feature_version: "market_snapshot_v1",
    market_session_context: {
      session: "london",
      trading_day: "2026-03-28",
      hour_bucket: 9,
      minutes_since_session_open: 60,
    },
    publication_session_window: "london",
    session_context: {
      timeframe: "15m",
      source: "oanda",
      quality_flag: "clean",
      session: {
        session: "london",
        tradingDay: "2026-03-28",
        hourBucket: 9,
        minutesSinceSessionOpen: 60,
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
    allocator_version: "trade_candidate_v2",
    pod_votes: [],
    supporting_evidence: {},
    allocator_metadata: {},
    directional_attribution: {
      long_score: 0.9,
      short_score: 0.1,
      neutral_score: 0,
      long_contributors: ["trend"],
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
      risk_reward_ratio: 1.8,
      entry_zone: { low: 1.084, high: 1.085, label: "entry" },
      invalidation_zone: { low: 1.081, high: 1.082, label: "invalid" },
      pre_entry_invalidation: "pre",
      post_entry_invalidation: "post",
      expires_after_bars: 3,
      expires_at: 1_710_000_090_000,
    },
    status: "proposed",
    created_at: 1_710_000_000_200,
  };
}

function makeRisk(decision: RiskEvaluatedCandidate["decision"] = "approved"): RiskEvaluatedCandidate {
  return {
    candidate_id: "candidate_EURUSD",
    cycle_id: "cycle_1",
    decision,
    blocking_rules: decision === "blocked" ? ["policy.kill_switch_active"] : [],
    warnings: [],
    size_adjustments: decision === "modified"
      ? {
        original_size: 0.15,
        approved_size: 0.075,
        approved_size_multiplier: 0.5,
      }
      : null,
    policy_evaluations: [],
    risk_version: "risk_evaluated_candidate_v2",
    approved_trade_plan: decision === "blocked" ? null : makeCandidate().proposed_trade_plan,
    authoritative_source: "legacy_risk_parity",
    shadow_decision: decision,
    shadow_mismatch: false,
    shadow_blocking_rules: decision === "blocked" ? ["policy.kill_switch_active"] : [],
    shadow_adjustments: [],
    explainability_score: 1,
    created_at: 1_710_000_000_300,
  };
}

function makeSignal(): ExecutableSignal {
  return {
    signal_id: "signal_EURUSD",
    cycle_id: "cycle_1",
    candidate_id: "candidate_EURUSD",
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

function makeLifecycle(state: string): SignalLifecycle {
  return {
    signal_id: "signal_EURUSD",
    current_state: state,
    fill_status: state === "activated" ? "open" : state === "expired" || state === "invalidated" ? "closed" : "pending",
    opened_at: state === "activated" ? 1_710_000_000_450 : null,
    updated_at: 1_710_000_000_500,
    closed_at: state === "expired" || state === "invalidated" ? 1_710_000_000_600 : null,
    pnl: null,
    execution_events: [],
  };
}

function makeState(overrides?: Partial<SignalViewModel>): TraderPairRuntimeState {
  const base: SignalViewModel = {
    id: "view_1",
    view_id: "view_1",
    entity_ref: "signal_EURUSD",
    signal_id: "signal_EURUSD",
    symbol: "EURUSD",
    cycleId: "cycle_1",
    generatedAt: 1_710_000_000_700,
    generated_at: 1_710_000_000_700,
    displayCategory: "executable",
    display_type: "executable",
    livePrice: 1.085,
    entry: 1.0845,
    sl: 1.0815,
    tp1: 1.09,
    tp2: 1.092,
    tp3: 1.094,
    direction: "buy",
    grade: "B",
    gradeScore: 72,
    setupType: "trend pullback",
    session: "London",
    bias: "bullish",
    structure: "continuation",
    liquidityState: "healthy",
    location: "discount",
    zoneType: "order block",
    marketPhase: "trend",
    confidence: 0.82,
    shortReasoning: "Bullish continuation remains intact.",
    detailedReasoning: "Bullish continuation remains intact with supportive structure.",
    whyThisSetup: "Trend alignment.",
    whyNow: "Pullback into support.",
    whyThisLevel: "Entry aligns with the pullback zone.",
    invalidation: "Break below swing low.",
    whyThisGrade: "Confluence and session alignment.",
    noTradeExplanation: null,
    marketStateLabels: ["active session"],
    noTradeReason: null,
    blockedReasons: [],
    riskStatus: "approved",
    riskRuleCodes: [],
    riskExplainability: [],
    podVotes: [],
    lifecycleState: "activated",
    status: "active",
    keyLevels: {
      pdh: 1.09,
      pdl: 1.08,
      sessionHigh: 1.088,
      sessionLow: 1.082,
    },
    marketStructureSummary: "Bullish structure.",
    liquiditySummary: "Liquidity remains supportive.",
    keyLevelsSummary: "Trading above session midpoint.",
    headline: "EURUSD BUY TREND",
    summary: "Bullish continuation remains intact.",
    reason_labels: ["active session"],
    confidence_label: "82% · B",
    ui_sections: {},
    commentary: null,
    ui_version: "signal_view_model_v4",
  };

  const card = { ...base, ...(overrides ?? {}) };
  return {
    symbol: "EURUSD",
    cycleId: "cycle_1",
    generatedAt: 1_710_000_000_700,
    snapshotAvailable: true,
    liveMarket: {
      symbol: "EURUSD",
      livePrice: card.livePrice,
      session: card.session,
      bias: card.bias as never,
      grade: card.grade as never,
      noTradeReason: card.noTradeReason as never,
      marketStateLabels: card.marketStateLabels as never,
      status: card.status as never,
    },
    marketReasoning: {
      symbol: "EURUSD",
      summary: card.shortReasoning,
      grade: card.grade as never,
      noTradeReason: card.noTradeReason as never,
      marketStateLabels: card.marketStateLabels as never,
      status: card.status as never,
    },
    keyAreas: {
      symbol: "EURUSD",
      previousDayHigh: card.keyLevels.pdh,
      previousDayLow: card.keyLevels.pdl,
      sessionHigh: card.keyLevels.sessionHigh,
      sessionLow: card.keyLevels.sessionLow,
      location: card.location as never,
      activeZone: card.zoneType,
    },
    card: {
      symbol: "EURUSD",
      livePrice: card.livePrice,
      direction: card.direction === "buy" ? "long" : card.direction === "sell" ? "short" : "neutral",
      grade: card.grade as never,
      setupType: card.setupType as never,
      session: card.session,
      bias: card.bias as never,
      structure: card.structure as never,
      liquidityState: card.liquidityState as never,
      location: card.location as never,
      zoneType: card.zoneType as never,
      marketPhase: card.marketPhase as never,
      entry: card.entry,
      sl: card.sl,
      tp1: card.tp1,
      tp2: card.tp2,
      tp3: card.tp3,
      shortReasoning: card.shortReasoning,
      detailedReasoning: {
        whyThisIsASetup: card.whyThisSetup,
        whyNow: card.whyNow,
        whyThisLevel: card.whyThisLevel,
        whatWouldInvalidateIt: card.invalidation,
        whyItGotItsGrade: card.whyThisGrade,
      },
      whyThisSetup: card.whyThisSetup,
      whyNow: card.whyNow,
      whyThisLevel: card.whyThisLevel,
      invalidation: card.invalidation,
      whyThisGrade: card.whyThisGrade,
      noTradeExplanation: card.noTradeExplanation,
      marketStructureSummary: card.marketStructureSummary,
      liquiditySummary: card.liquiditySummary,
      keyLevelsSummary: card.keyLevelsSummary,
      keyLevels: {
        previousDayHigh: card.keyLevels.pdh,
        previousDayLow: card.keyLevels.pdl,
        sessionHigh: card.keyLevels.sessionHigh,
        sessionLow: card.keyLevels.sessionLow,
        location: card.location as never,
        activeZone: card.zoneType,
      },
      noTradeReason: card.noTradeReason as never,
      whyNotValid: null,
      marketStateLabels: card.marketStateLabels as never,
      status: card.status,
      blockedReasons: card.blockedReasons,
      latestLifecycle: null,
      lifecycleState: card.lifecycleState,
      confidence: card.confidence,
      podVoteSummary: {
        directional: [],
        gating: [],
      },
    } as never,
    diagnostics: {
      symbol: "EURUSD",
      cycleId: "cycle_1",
      generatedAt: 1_710_000_000_700,
      marketData: {
        symbol: "EURUSD",
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
      snapshotAvailable: true,
      snapshotCreated: true,
      snapshotTimestamp: 1_710_000_000_000,
      candidateCreated: true,
      traderCardCreated: true,
      cardStatus: card.status,
      approvalStatus: card.riskStatus,
      noTradeReason: card.noTradeReason,
      blockedReasons: card.blockedReasons,
      unavailableReason: null,
    },
  };
}

test("sets displayCategory to executable for approved B+ signal", () => {
  const model = SignalViewModelBuilder.build({
    state: makeState({ grade: "B", riskStatus: "approved", status: "active" }),
    snapshot: makeSnapshot(),
    candidate: makeCandidate(),
    risk: makeRisk("approved"),
    signal: makeSignal(),
    lifecycle: makeLifecycle("activated"),
  });

  assert.equal(model?.displayCategory, "executable");
});

test("sets displayCategory to monitored for deferred signal", () => {
  const model = SignalViewModelBuilder.build({
    state: makeState({ grade: "B", riskStatus: "deferred", status: "watchlist" }),
    snapshot: makeSnapshot(),
    candidate: makeCandidate(),
    risk: null,
    signal: null,
    lifecycle: null,
  });

  assert.equal(model?.displayCategory, "monitored");
});

test("sets displayCategory to monitored for C-grade approved signal", () => {
  const model = SignalViewModelBuilder.build({
    state: makeState({ grade: "C", riskStatus: "approved", status: "watchlist" }),
    snapshot: makeSnapshot(),
    candidate: makeCandidate(),
    risk: makeRisk("approved"),
    signal: makeSignal(),
    lifecycle: makeLifecycle("activated"),
  });

  assert.equal(model?.displayCategory, "monitored");
});

test("sets displayCategory to rejected for risk-rejected signal", () => {
  const model = SignalViewModelBuilder.build({
    state: makeState({ grade: "B", riskStatus: "rejected", status: "blocked", blockedReasons: ["policy.kill_switch_active"] }),
    snapshot: makeSnapshot(),
    candidate: makeCandidate(),
    risk: makeRisk("blocked"),
    signal: null,
    lifecycle: null,
  });

  assert.equal(model?.displayCategory, "rejected");
});

test("watchlist cards with non-directional veto reasons stay monitored", () => {
  const model = SignalViewModelBuilder.build({
    state: makeState({
      direction: "neutral",
      grade: "F",
      riskStatus: "deferred",
      status: "watchlist",
      noTradeReason: "awaiting setup",
      blockedReasons: ["Directional bias is not clean enough."],
    }),
    snapshot: makeSnapshot(),
    candidate: {
      ...makeCandidate(),
      direction: "none",
      proposed_trade_plan: null,
      publication_status: "blocked",
      publication_reasons: ["PUBLICATION_POLICY_BLOCK"],
    },
    risk: {
      ...makeRisk("blocked"),
      publication_status: "blocked",
      publication_reasons: ["PUBLICATION_POLICY_BLOCK"],
    },
    signal: null,
    lifecycle: null,
  });

  assert.equal(model?.displayCategory, "monitored");
  assert.equal(model?.status, "watchlist");
  assert.equal(model?.publicationStatus, "watchlist_only");
});

test("sets displayCategory to rejected for invalidated lifecycle", () => {
  const model = SignalViewModelBuilder.build({
    state: makeState({ grade: "B", riskStatus: "approved", status: "invalidated" }),
    snapshot: makeSnapshot(),
    candidate: makeCandidate(),
    risk: makeRisk("approved"),
    signal: makeSignal(),
    lifecycle: makeLifecycle("invalidated"),
  });

  assert.equal(model?.displayCategory, "rejected");
});

test("sets status to active for approved B+ signal with active lifecycle", () => {
  const model = SignalViewModelBuilder.build({
    state: makeState({ grade: "B", riskStatus: "approved", status: "active" }),
    snapshot: makeSnapshot(),
    candidate: makeCandidate(),
    risk: makeRisk("approved"),
    signal: makeSignal(),
    lifecycle: makeLifecycle("activated"),
  });

  assert.equal(model?.status, "active");
});

test("sets status to blocked for rejected signal", () => {
  const model = SignalViewModelBuilder.build({
    state: makeState({ riskStatus: "rejected", status: "blocked", blockedReasons: ["policy.kill_switch_active"] }),
    snapshot: makeSnapshot(),
    candidate: makeCandidate(),
    risk: makeRisk("blocked"),
    signal: null,
    lifecycle: null,
  });

  assert.equal(model?.status, "blocked");
});

test("sets status to invalidated for invalidated lifecycle", () => {
  const model = SignalViewModelBuilder.build({
    state: makeState({ status: "invalidated" }),
    snapshot: makeSnapshot(),
    candidate: makeCandidate(),
    risk: makeRisk("approved"),
    signal: makeSignal(),
    lifecycle: makeLifecycle("invalidated"),
  });

  assert.equal(model?.status, "invalidated");
});

test("buildFromCycleOutput produces one viewmodel per signal in cycleOutput", () => {
  const cycleOutput: CycleOutput = {
    cycle_id: "cycle_1",
    started_at: 1_710_000_000_000,
    completed_at: 1_710_000_001_000,
    symbols_processed: ["EURUSD"],
    snapshots: [makeSnapshot()],
    candidates: [makeCandidate()],
    risk_results: [makeRisk("approved")],
    signals: [makeSignal()],
    metadata: {},
    versions: {
      feature_version: "market_snapshot_v1",
      pod_versions: {},
      allocator_version: "trade_candidate_v2",
      risk_version: "risk_evaluated_candidate_v2",
      trade_plan_version: "trade_plan_v1",
      view_model_version: "signal_view_model_v4",
      llm_prompt_version: null,
      data_source: ["oanda"],
      data_fetch_timestamps: [1_710_000_000_000],
    },
    pipeline_status: "completed",
    payload_source: "canonical",
  };

  const viewModels = SignalViewModelBuilder.buildFromCycleOutput(cycleOutput, { EURUSD: 1.0861 });

  assert.equal(viewModels.length, 1);
  assert.equal(viewModels[0]?.symbol, "EURUSD");
});

test("live prices are correctly overlaid from livePrices map", () => {
  const cycleOutput: CycleOutput = {
    cycle_id: "cycle_1",
    started_at: 1_710_000_000_000,
    completed_at: 1_710_000_001_000,
    symbols_processed: ["EURUSD"],
    snapshots: [makeSnapshot()],
    candidates: [makeCandidate()],
    risk_results: [makeRisk("approved")],
    signals: [makeSignal()],
    metadata: {},
    versions: {
      feature_version: "market_snapshot_v1",
      pod_versions: {},
      allocator_version: "trade_candidate_v2",
      risk_version: "risk_evaluated_candidate_v2",
      trade_plan_version: "trade_plan_v1",
      view_model_version: "signal_view_model_v4",
      llm_prompt_version: null,
      data_source: ["oanda"],
      data_fetch_timestamps: [1_710_000_000_000],
    },
    pipeline_status: "completed",
    payload_source: "canonical",
  };

  const viewModels = SignalViewModelBuilder.buildFromCycleOutput(cycleOutput, { EURUSD: 1.0864 });

  assert.equal(viewModels[0]?.livePrice, 1.0864);
});
