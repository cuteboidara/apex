import assert from "node:assert/strict";
import test from "node:test";

import { defaultMarketScopeConfig } from "@/src/config/marketScope";
import {
  buildCycleOutput,
  toExecutableSignal,
  toMarketSnapshot,
  toRiskEvaluatedCandidate,
  toSignalViewModel,
  toTradeCandidate,
} from "@/src/domain/services/signalPipelineMappers";
import type { AllocationIntent, FeatureSnapshot, PodEvaluation, RiskDecision } from "@/src/interfaces/contracts";
import type { ApexConfig } from "@/src/lib/config";
import { buildTraderPairRuntimeState } from "@/src/lib/trader";

const TRADER_CONFIG: Pick<ApexConfig, "pairProfiles"> = {
  pairProfiles: defaultMarketScopeConfig.pairProfiles,
};

function makeSnapshot(symbol = "EURUSD"): FeatureSnapshot {
  return {
    snapshot_id: `snap_${symbol}`,
    ts: 1_710_000_030_000,
    symbol_canonical: symbol,
    horizon: "15m",
    features: {
      mid: 1.085,
      ema_9: 1.0848,
      ema_21: 1.0842,
      atr_14: 0.002,
    },
    quality: {
      staleness_ms: 0,
      completeness: 1,
      confidence: 1,
    },
    context: {
      timeframe: "15m",
      source: "oanda",
      quality_flag: "clean",
      session: {
        session: "london",
        tradingDay: "2026-03-27",
        hourBucket: 9,
        minutesSinceSessionOpen: 90,
      },
      economic_event: {
        majorNewsFlag: false,
        minutesToNextHighImpactEvent: null,
        minutesSinceLastHighImpactEvent: null,
        eventType: null,
      },
      market_structure: {
        recentSwingHigh: 1.09,
        recentSwingLow: 1.082,
        previousSwingHigh: 1.088,
        previousSwingLow: 1.08,
        higherHighState: true,
        lowerLowState: false,
        structureBias: "bullish",
        breakOfStructure: "bullish",
        changeOfCharacter: "none",
        distanceToRecentStructure: 0.0012,
        distanceToSessionHigh: 0.001,
        distanceToSessionLow: 0.003,
        distanceToPreviousDayHigh: 0.002,
        distanceToPreviousDayLow: 0.004,
      },
      session_features: {
        asiaRangeSize: 0.004,
        londonRangeSize: 0.006,
        newYorkOpeningExpansion: 0,
        sessionBreakoutState: "bullish",
        sessionCompressionState: "normal",
        atrRelativeToNormal: 1.05,
      },
      tradeability: {
        spreadEstimateBps: 1.2,
        volatilityState: "acceptable",
        rewardToRiskFeasible: true,
        rewardToRiskPotential: 2.4,
        proximityToKeyStructure: 0.5,
        signalCrowdingOnPair: 0,
        pairVolatilityRegime: "normal",
      },
    },
  };
}

function makeCandidate(symbol = "EURUSD", overrides: Partial<AllocationIntent> = {}): AllocationIntent {
  return {
    candidate_id: `cand_${symbol}`,
    ts: 1_710_000_040_000,
    symbol_canonical: symbol,
    timeframe: "15m",
    regime: "trend",
    session: "london",
    direction: "buy",
    confidence: 0.81,
    entry_style: "trend_pullback",
    selected_pods: ["trend"],
    pod_weights: { trend: 1 },
    pod_vote_summary: {
      directional: [],
      gating: [],
    },
    trade_plan: {
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
      pre_entry_invalidation: "Cancel if structure fails before entry.",
      post_entry_invalidation: "Exit if invalidation zone breaks after entry.",
      expires_after_bars: 3,
      expires_at: 1_710_100_000_000,
    },
    entry: 1.0845,
    sl: 1.0815,
    tp1: 1.09,
    tp2: 1.092,
    tp3: 1.094,
    target_position: 0.15,
    reasoning: ["Trend continuation remains intact."],
    reason_codes: [],
    veto_reasons: [],
    portfolio_context: {
      gross_exposure: 0,
      net_exposure: 0,
      active_symbols: 0,
    },
    ...overrides,
  };
}

function makeRiskDecision(symbol = "EURUSD", overrides: Partial<RiskDecision> = {}): RiskDecision {
  return {
    ts: 1_710_000_050_000,
    scope: symbol,
    approval_status: "approved",
    approved_size_multiplier: 1,
    risk_check_results: {
      kill_switch: true,
      session_lock: true,
    },
    veto_reasons: [],
    warning_reasons: [],
    de_risking_action: "none",
    kill_switch_active: false,
    ...overrides,
  };
}

function makePodOutputs(symbol = "EURUSD"): PodEvaluation[] {
  return [{
    pod_id: "trend",
    ts: 1_710_000_045_000,
    symbol_canonical: symbol,
    decision_horizon: "15m",
    signal_type: "predictive",
    confidence: 0.81,
    recommended_action: "long",
    constraints: {},
    diagnostics: { trend_score: 81 },
    model_version: "trend_v1",
    pod_category: "directional",
    entry_style: "trend_pullback",
    rationale: ["Aligned bullish trend."],
    direction: "buy",
    score: 81,
    regime: "trend",
    regime_alignment: 0.8,
    tradeability_alignment: 0.76,
    entry_zone: null,
    invalidation_zone: null,
  }];
}

test("blocked candidates never produce executable signals", () => {
  const candidate = makeCandidate();
  const riskEvaluatedCandidate = toRiskEvaluatedCandidate({
    cycle_id: "cycle_1",
    candidate,
    risk_decision: makeRiskDecision(candidate.symbol_canonical, {
      approval_status: "rejected",
      veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
    }),
  });

  const executableSignal = toExecutableSignal({
    cycle_id: "cycle_1",
    candidate,
    risk_evaluated_candidate: riskEvaluatedCandidate,
    lifecycle: null,
  });

  assert.equal(riskEvaluatedCandidate.decision, "blocked");
  assert.equal(executableSignal, null);
});

test("non-directional candidates stay watchlist-only when live price comes from the snapshot", () => {
  const snapshot = makeSnapshot();
  const marketSnapshot = toMarketSnapshot({
    cycle_id: "cycle_watchlist",
    snapshot,
    market_data: {
      symbol: "EURUSD",
      interval: "15min",
      provider: "yahoo-finance",
      candlesFetched: 64,
      lastCandleTimestamp: snapshot.ts,
      latencyMs: 120,
      sourceMode: "live",
      usedFallback: true,
      qualityFlag: "clean",
      unavailableReason: null,
    },
  });
  const candidate = makeCandidate("EURUSD", {
    direction: "none",
    trade_plan: null,
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    tp3: null,
    veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
  });
  const riskEvaluatedCandidate = toRiskEvaluatedCandidate({
    cycle_id: "cycle_watchlist",
    snapshot: marketSnapshot,
    candidate,
    risk_decision: makeRiskDecision(candidate.symbol_canonical, {
      approval_status: "rejected",
      veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
    }),
  });

  assert.equal(riskEvaluatedCandidate.decision, "blocked");
  assert.equal(riskEvaluatedCandidate.publication_status, "watchlist_only");
  assert.ok(!riskEvaluatedCandidate.publication_reasons?.includes("NULL_PRICE"));
  assert.ok(!riskEvaluatedCandidate.publication_reasons?.includes("PUBLICATION_POLICY_BLOCK"));
});

test("approved_reduced risk decisions become modified candidates with size adjustments", () => {
  const candidate = makeCandidate();
  const riskEvaluatedCandidate = toRiskEvaluatedCandidate({
    cycle_id: "cycle_2",
    candidate,
    risk_decision: makeRiskDecision(candidate.symbol_canonical, {
      approval_status: "approved_reduced",
      approved_size_multiplier: 0.5,
      warning_reasons: ["VOL_TOO_HIGH"],
    }),
  });

  assert.equal(riskEvaluatedCandidate.decision, "modified");
  assert.equal(riskEvaluatedCandidate.size_adjustments?.original_size, 0.15);
  assert.equal(riskEvaluatedCandidate.size_adjustments?.approved_size, 0.075);
  assert.deepEqual(riskEvaluatedCandidate.warnings, ["VOL_TOO_HIGH"]);
});

test("signal view models keep UI state separate from canonical entity refs", () => {
  const snapshot = makeSnapshot();
  const marketSnapshot = toMarketSnapshot({
    cycle_id: "cycle_3",
    snapshot,
    market_data: {
      symbol: "EURUSD",
      interval: "15min",
      provider: "oanda",
      candlesFetched: 64,
      lastCandleTimestamp: snapshot.ts,
      latencyMs: 95,
      sourceMode: "live",
      usedFallback: false,
      qualityFlag: "clean",
      unavailableReason: null,
    },
  });
  const candidate = makeCandidate();
  const tradeCandidate = toTradeCandidate({
    cycle_id: "cycle_3",
    snapshot: marketSnapshot,
    candidate,
    pod_outputs: makePodOutputs(),
  });
  const riskEvaluatedCandidate = toRiskEvaluatedCandidate({
    cycle_id: "cycle_3",
    candidate,
    risk_decision: makeRiskDecision(),
  });
  const executableSignal = toExecutableSignal({
    cycle_id: "cycle_3",
    candidate,
    risk_evaluated_candidate: riskEvaluatedCandidate,
    lifecycle: null,
  });
  const state = buildTraderPairRuntimeState({
    symbol: "EURUSD",
    cycleId: "cycle_3",
    generatedAt: 1_710_000_060_000,
    snapshot,
    candidate,
    riskDecision: makeRiskDecision(),
    lifecycle: null,
    marketData: {
      symbol: "EURUSD",
      interval: "15min",
      provider: "oanda",
      candlesFetched: 64,
      lastCandleTimestamp: snapshot.ts,
      latencyMs: 95,
      sourceMode: "live",
      usedFallback: false,
      qualityFlag: "clean",
      unavailableReason: null,
    },
    config: TRADER_CONFIG,
  });

  const viewModel = toSignalViewModel({
    state,
    snapshot: marketSnapshot,
    candidate: tradeCandidate,
    risk_result: riskEvaluatedCandidate,
    executable_signal: executableSignal,
  });

  assert.ok(viewModel);
  assert.equal(viewModel?.display_type, "executable");
  assert.equal(viewModel?.entity_ref, executableSignal?.signal_id);
  assert.ok(viewModel?.ui_sections);
});

test("cycle output captures immutable stage artifacts and canonical provenance", () => {
  const snapshot = makeSnapshot();
  const marketSnapshot = toMarketSnapshot({
    cycle_id: "cycle_4",
    snapshot,
    market_data: {
      symbol: "EURUSD",
      interval: "15min",
      provider: "oanda",
      candlesFetched: 64,
      lastCandleTimestamp: snapshot.ts,
      latencyMs: 95,
      sourceMode: "live",
      usedFallback: false,
      qualityFlag: "clean",
      unavailableReason: null,
    },
  });
  const candidate = makeCandidate();
  const tradeCandidate = toTradeCandidate({
    cycle_id: "cycle_4",
    snapshot: marketSnapshot,
    candidate,
    pod_outputs: makePodOutputs(),
  });
  const riskEvaluatedCandidate = toRiskEvaluatedCandidate({
    cycle_id: "cycle_4",
    candidate,
    risk_decision: makeRiskDecision(),
  });
  const executableSignal = toExecutableSignal({
    cycle_id: "cycle_4",
    candidate,
    risk_evaluated_candidate: riskEvaluatedCandidate,
    lifecycle: null,
  });
  const monitoredState = buildTraderPairRuntimeState({
    symbol: "EURUSD",
    cycleId: "cycle_4",
    generatedAt: 1_710_000_060_000,
    snapshot,
    candidate,
    riskDecision: makeRiskDecision(),
    lifecycle: null,
    marketData: {
      symbol: "EURUSD",
      interval: "15min",
      provider: "oanda",
      candlesFetched: 64,
      lastCandleTimestamp: snapshot.ts,
      latencyMs: 95,
      sourceMode: "live",
      usedFallback: false,
      qualityFlag: "clean",
      unavailableReason: null,
    },
    config: TRADER_CONFIG,
  });
  const viewModel = toSignalViewModel({
    state: monitoredState,
    snapshot: marketSnapshot,
    candidate: tradeCandidate,
    risk_result: riskEvaluatedCandidate,
    executable_signal: executableSignal,
  });

  assert.ok(executableSignal);
  assert.ok(viewModel);

  const cycleOutput = buildCycleOutput({
    cycle_id: "cycle_4",
    started_at: 1_710_000_000_000,
    completed_at: 1_710_000_120_000,
    symbols_processed: ["EURUSD"],
    snapshots: [marketSnapshot],
    candidates: [tradeCandidate],
    risk_results: [riskEvaluatedCandidate],
    signals: executableSignal ? [executableSignal] : [],
    view_models: viewModel ? [viewModel] : [],
    pipeline_status: "completed",
  });

  const viewModels = cycleOutput.metadata.view_models as Array<{ view_id: string }>;
  assert.equal(cycleOutput.payload_source, "canonical");
  assert.equal(cycleOutput.signals.length, 1);
  assert.equal(viewModels.length, 1);
  assert.equal(cycleOutput.versions.allocator_version, "trade_candidate_v2");
});
