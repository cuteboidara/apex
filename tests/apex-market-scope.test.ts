import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { AuditJournal } from "@/src/audit/AuditJournal";
import { APEX_SYMBOLS, defaultMarketScopeConfig, isPairTradingSessionAllowed } from "@/src/config/marketScope";
import { ApexEngine } from "@/src/lib/engine";
import { loadApexConfig } from "@/src/lib/config";
import { ApexRepository } from "@/src/lib/repository";
import type { AlphaPodOutput, CanonicalMarketEvent, FeatureSnapshot, IAlphaPod } from "@/src/interfaces/contracts";
import { createDefaultPods } from "@/src/pods";

test("APEX config defaults to the narrowed FX universe with all entry styles enabled", () => {
  const config = loadApexConfig({ ...process.env });

  assert.deepEqual(config.activeSymbols, ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"]);
  assert.equal(config.primaryEntryStyle, "trend_pullback");
  assert.deepEqual(config.enabledEntryStyles, ["trend_pullback", "session_breakout", "range_reversal"]);
  assert.deepEqual(config.disabledEntryStyles, []);
  assert.deepEqual(config.activePods, ["trend", "breakout", "mean-reversion", "volatility-regime", "execution-advisory"]);
  assert.equal(config.defaultVenue, "oanda");
  assert.equal(config.pairProfiles.EURUSD?.maxSignalsPerDay, 4);
  assert.equal(config.minimumTelegramGrade, "B");
  assert.equal(config.includeBTelegramSignals, true);
  assert.equal(config.showBlockedSignalsOnMainDashboard, false);
  assert.equal(config.showAdvancedInternals, false);
});

test("APEX config skips optional and unsupported symbol overrides instead of activating them", () => {
  const config = loadApexConfig({
    ...process.env,
    ACTIVE_SYMBOLS: "EURUSD,GBPUSD,BTCUSD",
    ACTIVE_PODS: "trend,breakout,volatility-regime,execution-advisory,cross-asset-rv",
  });

  assert.deepEqual(config.activeSymbols, ["EURUSD", "GBPUSD"]);
  assert.deepEqual(config.scopeSkips.symbols, [
    { symbol: "BTCUSD", reason: "SYMBOL_NOT_SUPPORTED" },
  ]);
  assert.deepEqual(config.activePods, ["trend", "breakout", "volatility-regime", "execution-advisory"]);
  assert.deepEqual(config.scopeSkips.pods, [
    { podId: "cross-asset-rv", reason: "POD_NOT_IN_SCOPE" },
  ]);
});

test("overlap session is treated as tradable for pairs that allow London or New York", () => {
  assert.equal(isPairTradingSessionAllowed("overlap", ["london"]), true);
  assert.equal(isPairTradingSessionAllowed("overlap", ["new_york"]), true);
  assert.equal(isPairTradingSessionAllowed("overlap", ["asia"]), false);
  assert.equal(isPairTradingSessionAllowed("new_york", ["new_york"]), true);
});

test("engine cycle only requests the active FX symbols from the narrowed scope", async () => {
  const config = loadApexConfig({
    ...process.env,
    ACTIVE_SYMBOLS: "EURUSD,GBPUSD,USDJPY,EURJPY,AUDUSD,NZDUSD,USDCHF,USDCAD,BTCUSD",
    APEX_REQUIRE_LIVE_DATA: "false",
  });
  const repository = new ApexRepository();
  const requestedSymbols: string[] = [];
  const snapshot: FeatureSnapshot = {
    snapshot_id: "snap_1",
    ts: Date.now(),
    symbol_canonical: "EURUSD",
    horizon: "15m",
    features: {
      mid: 1.1,
      ema_9: 1.1,
      ema_21: 1.09,
      atr_14: 0.002,
      price_momentum_1h: 0.01,
      price_momentum_4h: 0.01,
      volatility_regime: 0,
    },
  quality: {
    staleness_ms: 0,
    completeness: 1,
    confidence: 1,
  },
  context: {
    timeframe: "15m",
    source: "synthetic",
    quality_flag: "clean",
    session: {
      session: "london",
      tradingDay: "2026-03-25",
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
};
  const event: CanonicalMarketEvent = {
    event_id: "evt_1",
    ts_exchange: Date.now(),
    ts_received: Date.now(),
    venue: "test",
    asset_class: "forex",
    symbol_raw: "EURUSD",
    symbol_canonical: "EURUSD",
    event_type: "ohlcv",
    sequence_number: 1,
    integrity_flags: [],
    price: 1.1,
    size: 1000,
    bid: 1.0999,
    ask: 1.1001,
    spread: 2,
  };
  const trendPod: IAlphaPod = {
    pod_id: "trend",
    model_version: "1.0.0",
    pod_category: "directional",
    evaluate: async (input: FeatureSnapshot): Promise<AlphaPodOutput> => ({
      pod_id: "trend",
      ts: Date.now(),
      symbol_canonical: input.symbol_canonical,
      decision_horizon: input.horizon,
      signal_type: "predictive",
      confidence: 0.65,
      recommended_action: "long",
      pod_category: "directional",
      entry_style: "trend_pullback",
      rationale: [],
      direction: "buy",
      score: 0.65,
      regime: "trend",
      regime_alignment: 0.65,
      tradeability_alignment: 0.65,
      entry_zone: null,
      invalidation_zone: null,
      constraints: {},
      diagnostics: {},
      model_version: "1.0.0",
      podName: "trend",
      version: "1.0.0",
      podType: "alpha",
      symbol: input.symbol_canonical,
      signal: "buy",
      reasoning: "trend",
      weight: 0.65,
      rawConfidence: 0.65,
      normalizedConfidence: 0.65,
      evidence: [],
      meta: {},
      pod_name: "trend",
      pod_version: "1.0.0",
      pod_type: "alpha",
      raw_confidence: 0.65,
      normalized_confidence: 0.65,
      veto: false,
      metadata: {},
    } as AlphaPodOutput),
    pause: () => undefined,
    resume: () => undefined,
    getStatus: () => "active",
    getDiagnostics: () => ({}),
  };
  const supportPod: IAlphaPod = {
    pod_id: "volatility-regime",
    model_version: "1.0.0",
    pod_category: "gating",
    evaluate: async (input: FeatureSnapshot): Promise<AlphaPodOutput> => ({
      pod_id: "volatility-regime",
      ts: Date.now(),
      symbol_canonical: input.symbol_canonical,
      decision_horizon: input.horizon,
      signal_type: "regime",
      confidence: 0.7,
      recommended_action: "hold",
      pod_category: "gating",
      entry_style: "support",
      rationale: [],
      gate_status: "allow",
      veto_reasons: [],
      state_assessment: "low_vol_trending",
      constraints: {},
      diagnostics: {},
      model_version: "1.0.0",
      podName: "volatility-regime",
      version: "1.0.0",
      podType: "regime",
      symbol: input.symbol_canonical,
      signal: "neutral",
      score: 70,
      reasoning: "volatility",
      weight: 0.7,
      rawConfidence: 0.7,
      normalizedConfidence: 0.7,
      evidence: [],
      meta: {},
      pod_name: "volatility-regime",
      pod_version: "1.0.0",
      pod_type: "regime",
      raw_confidence: 0.7,
      normalized_confidence: 0.7,
      veto: false,
      metadata: {},
    } as AlphaPodOutput),
    pause: () => undefined,
    resume: () => undefined,
    getStatus: () => "active",
    getDiagnostics: () => ({}),
  };
  const executionPod: IAlphaPod = {
    pod_id: "execution-advisory",
    model_version: "1.0.0",
    pod_category: "gating",
    evaluate: async (input: FeatureSnapshot): Promise<AlphaPodOutput> => ({
      pod_id: "execution-advisory",
      ts: Date.now(),
      symbol_canonical: input.symbol_canonical,
      decision_horizon: input.horizon,
      signal_type: "execution_advisory",
      confidence: 0.6,
      recommended_action: "hold",
      pod_category: "gating",
      entry_style: "support",
      rationale: [],
      gate_status: "allow",
      veto_reasons: [],
      constraints: {
        preferred_execution_style: "passive",
      },
      diagnostics: {},
      model_version: "1.0.0",
      podName: "execution-advisory",
      version: "1.0.0",
      podType: "execution_feasibility",
      symbol: input.symbol_canonical,
      signal: "buy",
      score: 60,
      reasoning: "execution",
      weight: 0.6,
      rawConfidence: 0.6,
      normalizedConfidence: 0.6,
      evidence: [],
      meta: {},
      pod_name: "execution-advisory",
      pod_version: "1.0.0",
      pod_type: "execution_feasibility",
      raw_confidence: 0.6,
      normalized_confidence: 0.6,
      veto: false,
      metadata: {},
    } as AlphaPodOutput),
    pause: () => undefined,
    resume: () => undefined,
    getStatus: () => "active",
    getDiagnostics: () => ({}),
  };
  const cycleSummaries: Array<{ rows: Array<{ symbol: string; action: string }>; status: string }> = [];

  const engine = new ApexEngine(
    config,
    repository,
    {
      connect: async () => undefined,
      ingestOHLCV: async (symbol: string) => {
        requestedSymbols.push(symbol);
        return {
          ...event,
          symbol_raw: symbol,
          symbol_canonical: symbol,
        };
      },
    } as never,
    {
      getLatestState: () => ({ prices: new Array(20).fill(1) }),
      consume: () => undefined,
      buildSnapshot: (symbol: string) => ({
        ...snapshot,
        symbol_canonical: symbol,
      }),
    } as never,
    [trendPod, supportPod, executionPod],
    {
      allocate: (symbol: string) => ({
        candidate_id: "sig_1",
        ts: Date.now(),
        symbol_canonical: symbol,
        timeframe: "15m",
        regime: "trend",
        session: "london",
        direction: "none",
        entry_style: "trend_pullback",
        selected_pods: ["trend"],
        pod_weights: { trend: 0.65 },
        pod_vote_summary: {
          directional: [],
          gating: [],
        },
        trade_plan: null,
        entry: null,
        sl: null,
        tp1: null,
        tp2: null,
        tp3: null,
        target_position: 0,
        confidence: 0.65,
        reasoning: [],
        portfolio_context: {
          gross_exposure: 0,
          net_exposure: 0,
          active_symbols: 0,
        },
        reason_codes: [],
        veto_reasons: [],
      }),
    } as never,
    {
      evaluate: () => ({
        ts: Date.now(),
        scope: "scope",
        approval_status: "approved",
        approved_size_multiplier: 1,
        risk_check_results: {},
        kill_switch_active: false,
      }),
    } as never,
    {
      advanceSignalLifecycles: async () => [],
      buildExecutionIntent: () => {
        throw new Error("execution should not be reached when target_position is zero");
      },
      execute: async () => {
        throw new Error("execution should not be reached when target_position is zero");
      },
    } as never,
    {
      run: async () => undefined,
    } as never,
    new AuditJournal(repository),
    {} as never,
    {
      sendCycleSummary: async (summary: { rows: Array<{ symbol: string; action: string }>; status: string }) => {
        cycleSummaries.push(summary);
        return true;
      },
      sendSignalAlert: async () => undefined,
      sendRiskAlert: async () => undefined,
      isConfigured: () => true,
    } as never,
  );

  await engine.runCycle();

  assert.deepEqual(requestedSymbols, ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"]);
  assert.equal(cycleSummaries.length, 1);
  assert.equal(cycleSummaries[0]?.status, "completed");
});

test("XAUUSD must never appear in any active or optional symbol list", () => {
  assert.deepEqual(
    [...defaultMarketScopeConfig.defaultActiveSymbols].sort(),
    ["AUDUSD", "EURJPY", "EURUSD", "GBPUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY"],
  );
  assert.equal(defaultMarketScopeConfig.defaultActiveSymbols.includes("XAUUSD" as never), false);
  assert.equal(defaultMarketScopeConfig.supportedSymbols.includes("XAUUSD" as never), false);
  assert.equal(APEX_SYMBOLS.includes("XAUUSD" as never), false);
});

test("final Phase 5 scope keeps the three core directional pods present and registered", () => {
  assert.equal(existsSync("src/pods/trend/TrendPod.ts"), true);
  assert.equal(existsSync("src/pods/breakout/BreakoutPod.ts"), true);
  assert.equal(existsSync("src/pods/mean-reversion/MeanReversionPod.ts"), true);

  const pods = createDefaultPods(() => null).map(pod => pod.pod_id).sort();
  assert.deepEqual(
    pods,
    ["breakout", "cross-asset-rv", "execution-advisory", "mean-reversion", "trend", "volatility-regime"],
  );
  assert.equal(pods.includes("trend"), true);
  assert.equal(pods.includes("breakout"), true);
  assert.equal(pods.includes("mean-reversion"), true);
});
