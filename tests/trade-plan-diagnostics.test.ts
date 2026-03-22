import test from "node:test";
import assert from "node:assert/strict";
import type { PlannedTrade } from "@/lib/tradePlanner";
import {
  applyTradePlanQualityGates,
  computeTradePlanLifecycle,
  type LifecycleSnapshot,
  type LifecycleTradePlan,
  type SignalProviderContext,
  type StylePerformanceGateState,
} from "@/lib/tradePlanDiagnostics";

function buildLifecyclePlan(overrides: Partial<LifecycleTradePlan> = {}): LifecycleTradePlan {
  return {
    id: "plan_1",
    runId: "run_1",
    signalId: "signal_1",
    symbol: "EURUSD",
    assetClass: "FOREX",
    style: "INTRADAY",
    setupFamily: "Displacement Pullback",
    bias: "LONG",
    status: "ACTIVE",
    entryMin: 99,
    entryMax: 101,
    stopLoss: 95,
    takeProfit1: 105,
    takeProfit2: 110,
    takeProfit3: 115,
    invalidationLevel: 95,
    detectedAt: new Date("2026-03-18T10:00:00.000Z"),
    createdAt: new Date("2026-03-18T10:00:00.000Z"),
    outcome: null,
    ...overrides,
  };
}

function buildSnapshot(at: string, low: number, high: number): LifecycleSnapshot {
  return {
    symbol: "EURUSD",
    capturedAt: new Date(at),
    timeframe: "quote",
    price: (low + high) / 2,
    open: null,
    high,
    low,
    close: null,
  };
}

function buildPlannedTrade(overrides: Partial<PlannedTrade> = {}): PlannedTrade {
  return {
    symbol: "EURUSD",
    assetClass: "FOREX",
    style: "SCALP",
    setupFamily: "Sweep Reversal",
    bias: "LONG",
    confidence: 72,
    timeframe: "15m / 1h",
    entryType: "LIMIT",
    entryMin: 99,
    entryMax: 101,
    stopLoss: 95,
    takeProfit1: 105,
    takeProfit2: 110,
    takeProfit3: 115,
    riskRewardRatio: 2,
    invalidationLevel: 95,
    regimeTag: "trend",
    liquidityThesis: "Liquidity sweep into discount.",
    trapThesis: "Late shorts are trapped.",
    setupScore: 72,
    publicationRank: "A",
    scoreBreakdown: {
      regimeAlignment: 10,
      liquidityQuality: 10,
      structureConfirmation: 10,
      trapEdge: 10,
      entryPrecision: 10,
      riskReward: 12,
      freshness: 10,
    },
    thesis: "Test thesis",
    executionNotes: "Test notes.",
    status: "ACTIVE",
    ...overrides,
  };
}

function buildGateState(overrides?: Partial<StylePerformanceGateState>): StylePerformanceGateState {
  return {
    degradedConfidenceFloor: 85,
    byStyle: {
      SCALP: {
        style: "SCALP",
        disabled: false,
        sampleSize: 0,
        winRate: null,
        averageRR: null,
        reason: null,
        lookbackDays: 21,
        minimumSampleSize: 12,
      },
      INTRADAY: {
        style: "INTRADAY",
        disabled: false,
        sampleSize: 0,
        winRate: null,
        averageRR: null,
        reason: null,
        lookbackDays: 21,
        minimumSampleSize: 12,
      },
      SWING: {
        style: "SWING",
        disabled: false,
        sampleSize: 0,
        winRate: null,
        averageRR: null,
        reason: null,
        lookbackDays: 21,
        minimumSampleSize: 12,
      },
    },
    ...overrides,
  };
}

test("trade plan lifecycle records TP1 before a later stop", () => {
  const plan = buildLifecyclePlan();
  const snapshots = [
    buildSnapshot("2026-03-18T10:05:00.000Z", 99.4, 100.6),
    buildSnapshot("2026-03-18T10:20:00.000Z", 101, 105.5),
    buildSnapshot("2026-03-18T10:45:00.000Z", 94.8, 103),
  ];

  const lifecycle = computeTradePlanLifecycle(plan, snapshots, new Date("2026-03-18T11:00:00.000Z"));

  assert.equal(lifecycle.entryHitAt?.toISOString(), "2026-03-18T10:05:00.000Z");
  assert.equal(lifecycle.tp1HitAt?.toISOString(), "2026-03-18T10:20:00.000Z");
  assert.equal(lifecycle.stopHitAt?.toISOString(), "2026-03-18T10:45:00.000Z");
  assert.equal(lifecycle.outcome, "STOP_AFTER_TP1");
  assert.equal(lifecycle.realizedRR, 1);
});

test("trade plan lifecycle expires cleanly when entry never fills", () => {
  const plan = buildLifecyclePlan({
    style: "SCALP",
    entryMin: 80,
    entryMax: 81,
  });
  const snapshots = [
    buildSnapshot("2026-03-18T12:00:00.000Z", 99, 101),
  ];

  const lifecycle = computeTradePlanLifecycle(plan, snapshots, new Date("2026-03-18T20:30:00.000Z"));

  assert.equal(lifecycle.entryHitAt, null);
  assert.equal(lifecycle.outcome, "EXPIRED");
  assert.ok(lifecycle.expiredAt);
});

test("quality gates suppress degraded low-confidence setups and paused scalp styles", () => {
  const providerContext: SignalProviderContext = {
    providerAtSignal: "Finnhub",
    providerHealthStateAtSignal: "DEGRADED",
    providerMarketStatusAtSignal: "DEGRADED",
    providerFallbackUsedAtSignal: true,
  };
  const gateState = buildGateState();
  gateState.byStyle.SCALP.disabled = true;
  gateState.byStyle.SCALP.reason = "Recent scalp performance is below threshold.";

  const [scalpPlan, intradayPlan] = applyTradePlanQualityGates(
    [
      buildPlannedTrade({ style: "SCALP", confidence: 90 }),
      buildPlannedTrade({ style: "INTRADAY", confidence: 70 }),
    ],
    providerContext,
    gateState
  );

  assert.equal(scalpPlan.status, "NO_SETUP");
  assert.equal(scalpPlan.qualityGateReason, "style_disabled_poor_performance");
  assert.equal(scalpPlan.publicationRank, "Silent");

  assert.equal(intradayPlan.status, "NO_SETUP");
  assert.equal(intradayPlan.qualityGateReason, "degraded_low_confidence");
  assert.equal(intradayPlan.publicationRank, "Silent");
});
