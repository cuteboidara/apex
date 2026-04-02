import assert from "node:assert/strict";
import test, { describe } from "node:test";

import { getCanonicalSignalsPayload } from "@/src/api/signals";
import { defaultMarketScopeConfig } from "@/src/config/marketScope";
import type { CycleOutput, SignalViewModel } from "@/src/domain/models/signalPipeline";
import { DataPlant } from "@/src/data-plant/DataPlant";
import { FeatureEngine } from "@/src/feature-engine/FeatureEngine";
import type {
  AllocationIntent,
  FeatureSnapshot,
  PairMarketDataDiagnostics,
  RiskDecision,
} from "@/src/interfaces/contracts";
import { getSignalsPayloadForRuntime } from "@/src/api/signals";
import { getSystemStatusPayloadForRuntime } from "@/src/api/system";
import type { ApexConfig } from "@/src/lib/config";
import { resetRedisStateForTests } from "@/src/lib/redis";
import { ApexRepository } from "@/src/lib/repository";
import {
  applyTraderLivePrices,
  buildTraderPairRuntimeState,
  buildTraderSignalsPayloadFromStates,
} from "@/src/lib/trader";

const BASE_CONFIG: ApexConfig = {
  databaseUrl: undefined,
  redisUrl: undefined,
  telegramBotToken: undefined,
  telegramChatId: undefined,
  oandaApiToken: undefined,
  oandaEnvironment: "practice",
  oandaApiBaseUrl: undefined,
  mode: "paper",
  cycleIntervalMinutes: 15,
  maxGrossExposure: 1,
  maxNetExposure: 0.5,
  drawdownWarningPct: 3,
  drawdownHardLimitPct: 5,
  maxSlippageBps: 15,
  marketScope: defaultMarketScopeConfig,
  activeSymbols: ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"],
  primaryEntryStyle: "trend_pullback",
  enabledEntryStyles: ["trend_pullback", "session_breakout", "range_reversal"],
  disabledEntryStyles: [],
  pairProfiles: { ...defaultMarketScopeConfig.pairProfiles },
  scopeSkips: {
    symbols: [],
    pods: [],
  },
  activePods: ["trend", "breakout", "mean-reversion", "volatility-regime", "execution-advisory"],
  defaultVenue: "oanda",
  requireLiveData: true,
  blockHighVolChaotic: true,
  maxActiveSymbols: 4,
  maxSymbolPosition: 0.2,
  maxNotionalUsd: 100000,
  volatilityTarget: 0.3,
  defaultRecoveryMode: "normal",
  minimumTelegramGrade: "A",
  includeBTelegramSignals: false,
  showBlockedSignalsOnMainDashboard: false,
  showAdvancedInternals: false,
};

const TRADER_CONFIG = {
  pairProfiles: {
    EURUSD: BASE_CONFIG.pairProfiles.EURUSD!,
    GBPUSD: BASE_CONFIG.pairProfiles.GBPUSD!,
  },
} satisfies Pick<ApexConfig, "pairProfiles">;

function makeMarketData(symbol: string, overrides: Partial<PairMarketDataDiagnostics> = {}): PairMarketDataDiagnostics {
  return {
    symbol,
    interval: "15min",
    provider: "oanda",
    candlesFetched: 64,
    lastCandleTimestamp: 1_710_000_000_000,
    latencyMs: 120,
    sourceMode: "live",
    usedFallback: false,
    qualityFlag: "clean",
    unavailableReason: null,
    ...overrides,
  };
}

function makeSnapshot(symbol = "EURUSD"): FeatureSnapshot {
  return {
    snapshot_id: `snap_${symbol}`,
    ts: 1_710_000_030_000,
    symbol_canonical: symbol,
    horizon: "15m",
    features: {
      mid: symbol === "GBPUSD" ? 1.2742 : 1.085,
      ema_9: symbol === "GBPUSD" ? 1.274 : 1.0848,
      ema_21: symbol === "GBPUSD" ? 1.2735 : 1.0842,
      atr_14: 0.002,
      price_momentum_1h: 0.004,
      price_momentum_4h: 0.007,
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
      market_structure: {
        recentSwingHigh: symbol === "GBPUSD" ? 1.279 : 1.09,
        recentSwingLow: symbol === "GBPUSD" ? 1.269 : 1.082,
        previousSwingHigh: symbol === "GBPUSD" ? 1.277 : 1.088,
        previousSwingLow: symbol === "GBPUSD" ? 1.267 : 1.08,
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
  const entry = symbol === "GBPUSD" ? 1.2738 : 1.0845;
  const sl = symbol === "GBPUSD" ? 1.2708 : 1.0815;
  const tp1 = symbol === "GBPUSD" ? 1.2792 : 1.09;
  const tp2 = symbol === "GBPUSD" ? 1.2812 : 1.092;
  const tp3 = symbol === "GBPUSD" ? 1.2832 : 1.094;

  return {
    candidate_id: `sig_${symbol}`,
    ts: 1_710_000_040_000,
    symbol_canonical: symbol,
    timeframe: "15m",
    regime: "trend",
    session: "london",
    direction: "buy",
    confidence: 0.84,
    entry_style: "trend_pullback",
    selected_pods: ["trend"],
    pod_weights: { trend: 1 },
    pod_vote_summary: {
      directional: [],
      gating: [],
    },
    trade_plan: {
      entry,
      sl,
      tp1,
      tp2,
      tp3,
      risk_reward_ratio: 1.83,
      entry_zone: {
        low: entry - 0.0005,
        high: entry + 0.0005,
        label: "Pullback zone",
      },
      invalidation_zone: {
        low: sl - 0.0005,
        high: sl + 0.0005,
        label: "Invalidation",
      },
      pre_entry_invalidation: "Cancel if price loses the pullback structure before entry.",
      post_entry_invalidation: "Exit if price breaks the invalidation zone after activation.",
      expires_after_bars: 3,
      expires_at: 1_710_100_000_000,
    },
    entry,
    sl,
    tp1,
    tp2,
    tp3,
    target_position: 0.15,
    reasoning: ["Bullish trend pullback remains intact."],
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
    risk_check_results: {},
    veto_reasons: [],
    warning_reasons: [],
    de_risking_action: "none",
    kill_switch_active: false,
    ...overrides,
  };
}

test("oanda fetch normalizes candles and flows into feature snapshot creation", async () => {
  resetRedisStateForTests();
  const originalFetch = globalThis.fetch;
  const candles = Array.from({ length: 6 }, (_, index) => ({
    complete: true,
    time: `${1_710_000_000 + (index * 900)}.000000000`,
    volume: 1200 + index,
    mid: {
      o: (1.08 + index * 0.0004).toFixed(4),
      h: (1.081 + index * 0.0004).toFixed(4),
      l: (1.079 + index * 0.0004).toFixed(4),
      c: (1.0805 + index * 0.0004).toFixed(4),
    },
  }));

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("api-fxpractice.oanda.com")) {
      return new Response(JSON.stringify({ candles }), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const repository = new ApexRepository();
    const dataPlant = new DataPlant(repository, {
      ...BASE_CONFIG,
      oandaApiToken: "test-token",
    });
    const latest = await dataPlant.ingestOHLCV("EURUSD", "15min");
    const featureEngine = new FeatureEngine(repository);
    for (const event of repository.getMarketEvents("EURUSD")) {
      featureEngine.consume(event);
    }
    const snapshot = featureEngine.buildSnapshot("EURUSD", "15m");
    const diagnostics = dataPlant.getLatestFetchDiagnostics("EURUSD");

    assert.ok(latest);
    assert.equal(diagnostics?.candlesFetched, 6);
    assert.equal(diagnostics?.provider, "oanda");
    assert.ok(snapshot);
    assert.ok((snapshot?.features.mid ?? 0) > 0);
    assert.equal(snapshot?.context.source, "oanda");
    assert.ok(snapshot?.context.market_structure);
    assert.ok(snapshot?.context.session_features);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("trader runtime state stays populated when the pair is under analysis and snapshot exists", () => {
  const state = buildTraderPairRuntimeState({
    symbol: "EURUSD",
    cycleId: "cycle_live_1",
    generatedAt: 1_710_000_060_000,
    snapshot: makeSnapshot("EURUSD"),
    candidate: makeCandidate("EURUSD", {
      direction: "none",
      confidence: 0.61,
      trade_plan: null,
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      tp3: null,
      veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
    }),
    riskDecision: makeRiskDecision("EURUSD", {
      approval_status: "rejected",
      veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
    }),
    lifecycle: null,
    marketData: makeMarketData("EURUSD"),
    config: TRADER_CONFIG,
  });

  assert.equal(state.snapshotAvailable, true);
  assert.equal(state.liveMarket.livePrice, 1.085);
  assert.equal(state.card?.status, "watchlist");
  assert.notEqual(state.marketReasoning.summary, "No live snapshot is available yet.");
  assert.ok(state.keyAreas.previousDayHigh != null);
  assert.equal(state.diagnostics.snapshotCreated, true);
  assert.equal(state.diagnostics.candidateCreated, true);
  assert.equal(state.diagnostics.traderCardCreated, true);
  assert.match(state.diagnostics.noTradeReason ?? "", /directional bias is not clean enough/i);
});

test("dashboard payload keeps live market state when pairs are still being analysed", () => {
  const analysisState = buildTraderPairRuntimeState({
    symbol: "EURUSD",
    cycleId: "cycle_live_2",
    generatedAt: 1_710_000_070_000,
    snapshot: makeSnapshot("EURUSD"),
    candidate: makeCandidate("EURUSD", {
      direction: "none",
      confidence: 0.61,
      trade_plan: null,
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      tp3: null,
      veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
    }),
    riskDecision: makeRiskDecision("EURUSD", {
      approval_status: "rejected",
      veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
    }),
    lifecycle: null,
    marketData: makeMarketData("EURUSD"),
    config: TRADER_CONFIG,
  });
  const watchlistState = buildTraderPairRuntimeState({
    symbol: "GBPUSD",
    cycleId: "cycle_live_2",
    generatedAt: 1_710_000_070_500,
    snapshot: makeSnapshot("GBPUSD"),
    candidate: null,
    riskDecision: null,
    lifecycle: null,
    marketData: makeMarketData("GBPUSD"),
    config: TRADER_CONFIG,
  });

  const payload = buildTraderSignalsPayloadFromStates({
    activeSymbols: ["EURUSD", "GBPUSD"],
    states: [analysisState, watchlistState],
    preferences: {
      meaningfulSignalFloor: "B",
      minimumTelegramGrade: "A",
      includeBTelegramSignals: false,
      showBlockedSignalsOnMainDashboard: false,
      showAdvancedInternals: true,
    },
  });

  assert.equal(payload.liveMarketBoard.length, 2);
  assert.equal(payload.liveMarketBoard.find(row => row.symbol === "EURUSD")?.livePrice, 1.085);
  assert.equal(payload.liveMarketBoard.find(row => row.symbol === "EURUSD")?.status, "watchlist");
  assert.equal(payload.liveMarketBoard.find(row => row.symbol === "GBPUSD")?.status, "watchlist");
  assert.deepEqual(payload.blockedSignals.map(card => card.symbol), []);
  assert.deepEqual(payload.watchlistSignals.map(card => card.symbol), ["EURUSD"]);
  assert.deepEqual(
    payload.liveMarketBoard
      .filter(row => row.status === "watchlist")
      .map(row => row.symbol)
      .sort(),
    ["EURUSD", "GBPUSD"],
  );
  assert.equal(payload.activeSignals.length, 0);
  assert.notEqual(payload.marketReasoning.find(row => row.symbol === "GBPUSD")?.summary, "No live snapshot is available yet.");
  assert.equal(payload.marketReasoning.find(row => row.symbol === "GBPUSD")?.noTradeReason, "awaiting setup");
  assert.ok(payload.liveMarketBoard.find(row => row.symbol === "GBPUSD")?.marketStateLabels.includes("active session"));
  assert.ok(payload.keyAreas.every(area => area.previousDayHigh != null));
  assert.equal(payload.diagnostics.find(row => row.symbol === "GBPUSD")?.candidateCreated, false);
});

test("live market board explains off-session low-volatility states even without a valid signal", () => {
  const state = buildTraderPairRuntimeState({
    symbol: "EURUSD",
    cycleId: "cycle_live_2b",
    generatedAt: 1_710_000_071_000,
    snapshot: {
      ...makeSnapshot("EURUSD"),
      context: {
        ...makeSnapshot("EURUSD").context,
        session: {
          session: "off_hours",
          tradingDay: "2026-03-25",
          hourBucket: 23,
          minutesSinceSessionOpen: 30,
        },
        market_structure: {
          ...makeSnapshot("EURUSD").context.market_structure!,
          breakOfStructure: "none",
          structureBias: "neutral",
        },
        session_features: {
          ...makeSnapshot("EURUSD").context.session_features!,
          sessionBreakoutState: "none",
          sessionCompressionState: "compressed",
        },
        tradeability: {
          ...makeSnapshot("EURUSD").context.tradeability!,
          volatilityState: "too_low",
          pairVolatilityRegime: "low",
        },
      },
    },
    candidate: null,
    riskDecision: null,
    lifecycle: null,
    marketData: makeMarketData("EURUSD"),
    config: TRADER_CONFIG,
  });

  const payload = buildTraderSignalsPayloadFromStates({
    activeSymbols: ["EURUSD"],
    states: [state],
    preferences: {
      meaningfulSignalFloor: "B",
      minimumTelegramGrade: "A",
      includeBTelegramSignals: false,
      showBlockedSignalsOnMainDashboard: false,
      showAdvancedInternals: false,
    },
  });

  assert.equal(payload.liveMarketBoard[0]?.noTradeReason, "off session");
  assert.ok(payload.liveMarketBoard[0]?.marketStateLabels.includes("low liquidity"));
  assert.ok(payload.liveMarketBoard[0]?.marketStateLabels.includes("dead market"));
  assert.match(payload.marketReasoning[0]?.summary ?? "", /outside the active trading session|no signal yet/i);
});

test("live market board explains low-volatility states during active sessions", () => {
  const baseline = makeSnapshot("EURUSD");
  const state = buildTraderPairRuntimeState({
    symbol: "EURUSD",
    cycleId: "cycle_live_2c",
    generatedAt: 1_710_000_071_500,
    snapshot: {
      ...baseline,
      context: {
        ...baseline.context,
        market_structure: {
          ...baseline.context.market_structure!,
          breakOfStructure: "none",
          structureBias: "neutral",
        },
        session_features: {
          ...baseline.context.session_features!,
          sessionBreakoutState: "none",
          sessionCompressionState: "compressed",
        },
        tradeability: {
          ...baseline.context.tradeability!,
          volatilityState: "too_low",
          pairVolatilityRegime: "low",
        },
      },
    },
    candidate: null,
    riskDecision: null,
    lifecycle: null,
    marketData: makeMarketData("EURUSD"),
    config: TRADER_CONFIG,
  });

  const payload = buildTraderSignalsPayloadFromStates({
    activeSymbols: ["EURUSD"],
    states: [state],
    preferences: {
      meaningfulSignalFloor: "B",
      minimumTelegramGrade: "A",
      includeBTelegramSignals: false,
      showBlockedSignalsOnMainDashboard: false,
      showAdvancedInternals: false,
    },
  });

  assert.equal(payload.liveMarketBoard[0]?.noTradeReason, "low volatility");
  assert.ok(payload.liveMarketBoard[0]?.marketStateLabels.includes("active session"));
  assert.ok(payload.liveMarketBoard[0]?.marketStateLabels.includes("dead market"));
});

test("signals API payload uses persisted pair runtime states for usable trader fields", async () => {
  const state = buildTraderPairRuntimeState({
    symbol: "EURUSD",
    cycleId: "cycle_live_3",
    generatedAt: 1_710_000_080_000,
    snapshot: makeSnapshot("EURUSD"),
    candidate: null,
    riskDecision: null,
    lifecycle: null,
    marketData: makeMarketData("EURUSD"),
    config: TRADER_CONFIG,
  });

  const payload = await getSignalsPayloadForRuntime({
    config: {
      activeSymbols: ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"],
      marketScope: defaultMarketScopeConfig,
      minimumTelegramGrade: "A",
      includeBTelegramSignals: false,
      showBlockedSignalsOnMainDashboard: false,
      showAdvancedInternals: false,
      pairProfiles: BASE_CONFIG.pairProfiles,
    },
    repository: {
      getLatestTraderPairRuntimeStates: async () => [state],
      getLatestSignalCandidates: () => [],
      getLatestFeatureSnapshots: () => [],
      getRecentRiskDecisions: () => [],
      getSignalLifecycles: () => [],
    },
  } as never, {
    fetchLivePrices: async () => ({
      EURUSD: 1.0861,
      GBPUSD: 1.2748,
      USDJPY: 149.52,
      EURJPY: 161.84,
      AUDUSD: 0.6621,
      NZDUSD: 0.6124,
      USDCHF: 0.8842,
      USDCAD: 1.3528,
    }),
  });

  assert.equal(payload.liveMarketBoard.find(row => row.symbol === "EURUSD")?.livePrice, 1.0861);
  assert.equal(payload.liveMarketBoard.find(row => row.symbol === "EURUSD")?.status, "watchlist");
  assert.notEqual(payload.marketReasoning.find(row => row.symbol === "EURUSD")?.summary, "No live snapshot is available yet.");
  assert.ok(payload.keyAreas.find(row => row.symbol === "EURUSD")?.previousDayHigh != null);
  assert.equal(payload.diagnostics.find(row => row.symbol === "EURUSD")?.snapshotCreated, true);
});

test("live price overlay uses Twelve Data values and clears non-live fallbacks when unavailable", () => {
  const payload = buildTraderSignalsPayloadFromStates({
    activeSymbols: ["EURUSD", "GBPUSD"],
    states: [
      buildTraderPairRuntimeState({
        symbol: "EURUSD",
        cycleId: "cycle_live_5",
        generatedAt: 1_710_000_100_000,
        snapshot: makeSnapshot("EURUSD"),
        candidate: makeCandidate("EURUSD"),
        riskDecision: makeRiskDecision("EURUSD"),
        lifecycle: null,
        marketData: makeMarketData("EURUSD"),
        config: TRADER_CONFIG,
      }),
      buildTraderPairRuntimeState({
        symbol: "GBPUSD",
        cycleId: "cycle_live_5",
        generatedAt: 1_710_000_100_500,
        snapshot: makeSnapshot("GBPUSD"),
        candidate: null,
        riskDecision: null,
        lifecycle: null,
        marketData: makeMarketData("GBPUSD"),
        config: TRADER_CONFIG,
      }),
    ],
    preferences: {
      meaningfulSignalFloor: "B",
      minimumTelegramGrade: "A",
      includeBTelegramSignals: false,
      showBlockedSignalsOnMainDashboard: false,
      showAdvancedInternals: false,
    },
  });

  const patched = applyTraderLivePrices(payload, {
    EURUSD: 1.0864,
    GBPUSD: null,
  });

  assert.equal(patched.liveMarketBoard.find(row => row.symbol === "EURUSD")?.livePrice, 1.0864);
  assert.equal(patched.cards.find(card => card.symbol === "EURUSD")?.livePrice, 1.0864);
  assert.equal(patched.liveMarketBoard.find(row => row.symbol === "GBPUSD")?.livePrice, null);
});

describe("signals API — fallback path when persisted states are missing", () => {
  test("fallback path returns the same top-level payload shape as the primary path", async () => {
    const payload = await getSignalsPayloadForRuntime({
      config: {
        activeSymbols: ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"],
        marketScope: defaultMarketScopeConfig,
        minimumTelegramGrade: "A",
        includeBTelegramSignals: false,
        showBlockedSignalsOnMainDashboard: false,
        showAdvancedInternals: false,
        pairProfiles: BASE_CONFIG.pairProfiles,
      },
      repository: {
        getLatestTraderPairRuntimeStates: async () => [],
        getLatestSignalCandidates: () => [makeCandidate("EURUSD")],
        getLatestFeatureSnapshots: () => [makeSnapshot("EURUSD")],
        getRecentRiskDecisions: () => [makeRiskDecision("EURUSD")],
        getSignalLifecycles: () => [],
      },
    } as never, {
      fetchLivePrices: async () => ({
        EURUSD: 1.0862,
        GBPUSD: 1.2748,
        USDJPY: 149.52,
        EURJPY: 161.84,
      }),
    });

    const requiredKeys = [
      "generatedAt",
      "cards",
      "liveMarketBoard",
      "activeSignals",
      "developingSetups",
      "blockedSignals",
      "watchlistSignals",
      "marketReasoning",
      "keyAreas",
      "diagnostics",
      "preferences",
    ] as const;

    for (const key of requiredKeys) {
      assert.notEqual(payload[key], undefined);
    }

    assert.equal(typeof payload.generatedAt, "number");
    assert.ok(Array.isArray(payload.cards));
    assert.ok(Array.isArray(payload.liveMarketBoard));
    assert.ok(Array.isArray(payload.activeSignals));
    assert.ok(Array.isArray(payload.developingSetups));
    assert.ok(Array.isArray(payload.blockedSignals));
    assert.ok(Array.isArray(payload.watchlistSignals));
    assert.ok(Array.isArray(payload.marketReasoning));
    assert.ok(Array.isArray(payload.keyAreas));
    assert.ok(Array.isArray(payload.diagnostics));
    assert.equal(typeof payload.preferences, "object");
  });

  test("fallback path returns one liveMarketBoard row per active symbol even with no approved signals", async () => {
    const payload = await getSignalsPayloadForRuntime({
      config: {
        activeSymbols: ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"],
        marketScope: defaultMarketScopeConfig,
        minimumTelegramGrade: "A",
        includeBTelegramSignals: false,
        showBlockedSignalsOnMainDashboard: false,
        showAdvancedInternals: false,
        pairProfiles: BASE_CONFIG.pairProfiles,
      },
      repository: {
        getLatestTraderPairRuntimeStates: async () => [],
        getLatestSignalCandidates: () => [makeCandidate("EURUSD", { direction: "none", trade_plan: null })],
        getLatestFeatureSnapshots: () => [
          makeSnapshot("EURUSD"),
          makeSnapshot("GBPUSD"),
          makeSnapshot("USDJPY"),
          makeSnapshot("EURJPY"),
          makeSnapshot("AUDUSD"),
          makeSnapshot("NZDUSD"),
          makeSnapshot("USDCHF"),
          makeSnapshot("USDCAD"),
        ],
        getRecentRiskDecisions: () => [makeRiskDecision("EURUSD", { approval_status: "rejected" })],
        getSignalLifecycles: () => [],
      },
    } as never, {
      fetchLivePrices: async () => ({
        EURUSD: 1.0862,
        GBPUSD: 1.2748,
        USDJPY: 149.52,
        EURJPY: 161.84,
        AUDUSD: 0.6621,
        NZDUSD: 0.6124,
        USDCHF: 0.8842,
        USDCAD: 1.3528,
      }),
    });

    assert.equal(payload.liveMarketBoard.length, 8);
    assert.deepEqual(
      payload.liveMarketBoard.map(row => row.symbol).sort(),
      ["AUDUSD", "EURJPY", "EURUSD", "GBPUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY"],
    );
  });

  test("fallback path does not throw when both persisted states and raw snapshots are missing", async () => {
    const payload = await getSignalsPayloadForRuntime({
      config: {
        activeSymbols: ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"],
        marketScope: defaultMarketScopeConfig,
        minimumTelegramGrade: "A",
        includeBTelegramSignals: false,
        showBlockedSignalsOnMainDashboard: false,
        showAdvancedInternals: false,
        pairProfiles: BASE_CONFIG.pairProfiles,
      },
      repository: {
        getLatestTraderPairRuntimeStates: async () => [],
        getLatestSignalCandidates: () => [],
        getLatestFeatureSnapshots: () => [],
        getRecentRiskDecisions: () => [],
        getSignalLifecycles: () => [],
      },
    } as never, {
      fetchLivePrices: async () => ({
        EURUSD: null,
        GBPUSD: null,
        USDJPY: null,
        EURJPY: null,
        AUDUSD: null,
        NZDUSD: null,
        USDCHF: null,
        USDCAD: null,
      }),
    });

    assert.deepEqual(payload.activeSignals, []);
    assert.ok(Array.isArray(payload.liveMarketBoard));
  });

  test("fallback path noTradeReason is populated when no snapshot exists", async () => {
    const payload = await getSignalsPayloadForRuntime({
      config: {
        activeSymbols: ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"],
        marketScope: defaultMarketScopeConfig,
        minimumTelegramGrade: "A",
        includeBTelegramSignals: false,
        showBlockedSignalsOnMainDashboard: false,
        showAdvancedInternals: false,
        pairProfiles: BASE_CONFIG.pairProfiles,
      },
      repository: {
        getLatestTraderPairRuntimeStates: async () => [],
        getLatestSignalCandidates: () => [],
        getLatestFeatureSnapshots: () => [makeSnapshot("EURUSD")],
        getRecentRiskDecisions: () => [],
        getSignalLifecycles: () => [],
      },
    } as never, {
      fetchLivePrices: async () => ({
        EURUSD: 1.0862,
        GBPUSD: null,
        USDJPY: null,
        EURJPY: null,
        AUDUSD: null,
        NZDUSD: null,
        USDCHF: null,
        USDCAD: null,
      }),
    });

    assert.equal(payload.liveMarketBoard.find(row => row.symbol === "GBPUSD")?.noTradeReason, "data unavailable");
  });
});

test("system status falls back to newer persisted pair states when web memory is stale", async () => {
  const state = buildTraderPairRuntimeState({
    symbol: "EURUSD",
    cycleId: "cycle_live_4",
    generatedAt: 1_710_000_090_000,
    snapshot: makeSnapshot("EURUSD"),
    candidate: null,
    riskDecision: null,
    lifecycle: null,
    marketData: makeMarketData("EURUSD", {
      lastCandleTimestamp: 1_710_000_089_000,
      latencyMs: 95,
    }),
    config: TRADER_CONFIG,
  });

  const payload = await getSystemStatusPayloadForRuntime({
    config: {
      activeSymbols: ["EURUSD"],
      defaultVenue: "oanda",
      cycleIntervalMinutes: 15,
      activePods: ["trend"],
      primaryEntryStyle: "trend_pullback",
    },
    ops: {
      getSystemStatus: () => ({
        mode: "normal",
        kill_switch_active: false,
        last_cycle_ts: 1_710_000_010_000,
        active_symbols: ["EURUSD"],
        modules: [],
        feed_health: [{
          symbol_canonical: "EURUSD",
          latency_ms: 0,
          last_received_ts: null,
          gap_count: 0,
          quarantined: false,
        }],
        readiness: {
          market_data_status: "degraded",
          provider_latency_ms: 0,
          stale_symbols: ["EURUSD"],
          news_lock_active: false,
          session_lock_active: false,
        },
      }),
    },
    repository: {
      getLatestTraderPairRuntimeStates: async () => [state],
      getExecutionHealth: () => [],
    },
  } as never);

  assert.equal(payload.last_cycle_ts, 1_710_000_090_000);
  assert.equal(payload.feed_health[0]?.last_received_ts, 1_710_000_089_000);
  assert.equal(payload.feed_health[0]?.provider, "oanda");
  assert.ok(payload.readiness);
  assert.equal(payload.readiness?.market_data_status, "healthy");
  assert.equal(payload.readiness?.provider_latency_ms, 95);
});

describe("Phase 4 — Signal display categories", () => {
  function makeCanonicalViewModel(
    symbol: string,
    displayCategory: SignalViewModel["displayCategory"],
    status: SignalViewModel["status"],
  ): SignalViewModel {
    return {
      id: `view_${symbol}`,
      view_id: `view_${symbol}`,
      entity_ref: `entity_${symbol}`,
      signal_id: displayCategory === "executable" ? `signal_${symbol}` : null,
      symbol,
      cycleId: "cycle_phase4",
      generatedAt: 1_710_000_200_000,
      generated_at: 1_710_000_200_000,
      displayCategory,
      display_type: displayCategory,
      livePrice: 1.1,
      entry: displayCategory === "executable" ? 1.099 : null,
      sl: displayCategory === "executable" ? 1.096 : null,
      tp1: displayCategory === "executable" ? 1.106 : null,
      tp2: null,
      tp3: null,
      direction: displayCategory === "rejected" ? "neutral" : "buy",
      grade: displayCategory === "monitored" ? "C" : "B",
      gradeScore: displayCategory === "monitored" ? 58 : 72,
      setupType: "trend pullback",
      session: "London",
      bias: "bullish",
      structure: "continuation",
      liquidityState: "healthy",
      location: "discount",
      zoneType: "order block",
      marketPhase: "trend",
      confidence: 0.78,
      shortReasoning: `${symbol} ${displayCategory} reasoning`,
      detailedReasoning: `${symbol} ${displayCategory} detailed reasoning`,
      whyThisSetup: "Aligned structure.",
      whyNow: "Session timing is favorable.",
      whyThisLevel: "Level aligns with structure.",
      invalidation: "Break of swing invalidates.",
      whyThisGrade: "Confluence supports the current grade.",
      noTradeExplanation: displayCategory === "monitored" ? "Still developing." : displayCategory === "rejected" ? "Blocked by risk." : null,
      marketStateLabels: ["active session"],
      noTradeReason: displayCategory === "monitored" ? "awaiting setup" : displayCategory === "rejected" ? "blocked by risk" : null,
      blockedReasons: displayCategory === "rejected" ? ["policy.kill_switch_active"] : [],
      riskStatus: displayCategory === "rejected" ? "rejected" : displayCategory === "monitored" ? "deferred" : "approved",
      riskRuleCodes: displayCategory === "rejected" ? ["policy.kill_switch_active"] : [],
      riskExplainability: displayCategory === "rejected" ? ["Kill switch active"] : [],
      podVotes: [],
      lifecycleState: displayCategory === "executable" ? "activated" : null,
      status,
      keyLevels: {
        pdh: 1.11,
        pdl: 1.09,
        sessionHigh: 1.108,
        sessionLow: 1.094,
      },
      marketStructureSummary: "Bullish continuation.",
      liquiditySummary: "Liquidity remains healthy.",
      keyLevelsSummary: "Holding above session midpoint.",
      headline: `${symbol} ${displayCategory}`,
      summary: `${symbol} ${displayCategory} summary`,
      reason_labels: [],
      confidence_label: "78% · B",
      ui_sections: {},
      commentary: null,
      ui_version: "signal_view_model_v4",
    };
  }

  function makeCanonicalCycleOutput(): CycleOutput {
    return {
      cycle_id: "cycle_phase4",
      started_at: 1_710_000_200_000,
      completed_at: 1_710_000_201_000,
      symbols_processed: BASE_CONFIG.activeSymbols,
      snapshots: BASE_CONFIG.activeSymbols.map(symbol => ({
        snapshot_id: `snapshot_${symbol}`,
        cycle_id: "cycle_phase4",
        symbol,
        timestamp: 1_710_000_200_000,
        features: { mid: 1.1 },
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
        created_at: 1_710_000_200_000,
        data_fetch_timestamps: [1_710_000_200_000],
      })),
      candidates: [],
      risk_results: [],
      signals: [],
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
        data_fetch_timestamps: [1_710_000_200_000],
      },
      pipeline_status: "completed",
      payload_source: "canonical",
    };
  }

  test("approved B+ signals appear in executable and all active pairs appear in liveMarketBoard", async () => {
    const executable = makeCanonicalViewModel("EURUSD", "executable", "active");
    const monitored = makeCanonicalViewModel("GBPUSD", "monitored", "watchlist");
    const rejected = makeCanonicalViewModel("USDJPY", "rejected", "blocked");
    const cycleOutput = makeCanonicalCycleOutput();

    const payload = await getCanonicalSignalsPayload({
      readCanonicalBundle: async () => ({
        cycleOutput,
        viewModels: [executable, monitored, rejected],
        lifecycles: new Map(),
      }),
      fetchPrices: async () => ({
        EURUSD: 1.0861,
        GBPUSD: 1.2748,
        USDJPY: 149.52,
        EURJPY: 161.84,
        AUDUSD: 0.6621,
        NZDUSD: 0.6124,
        USDCHF: 0.8842,
        USDCAD: 1.3528,
      }),
    });

    assert.deepEqual(payload.executable.map(signal => signal.symbol), ["EURUSD"]);
    assert.deepEqual(payload.monitored.map(signal => signal.symbol), ["GBPUSD"]);
    assert.deepEqual(payload.rejected.map(signal => signal.symbol), ["USDJPY"]);
    assert.equal(payload.liveMarketBoard.length, 8);
  });

  test("executable array never contains rejected or monitored signals", async () => {
    const payload = await getCanonicalSignalsPayload({
      readCanonicalBundle: async () => ({
        cycleOutput: makeCanonicalCycleOutput(),
        viewModels: [
          makeCanonicalViewModel("EURUSD", "executable", "active"),
          makeCanonicalViewModel("GBPUSD", "monitored", "watchlist"),
          makeCanonicalViewModel("USDJPY", "rejected", "blocked"),
        ],
        lifecycles: new Map(),
      }),
      fetchPrices: async () => ({
        EURUSD: 1.0861,
        GBPUSD: 1.2748,
        USDJPY: 149.52,
        EURJPY: 161.84,
        AUDUSD: 0.6621,
        NZDUSD: 0.6124,
        USDCHF: 0.8842,
        USDCAD: 1.3528,
      }),
    });

    assert.deepEqual(payload.executable.map(signal => signal.displayCategory), ["executable"]);
    assert.ok(payload.executable.every(signal => signal.displayCategory === "executable"));
    assert.ok(payload.monitored.every(signal => signal.displayCategory === "monitored"));
    assert.ok(payload.rejected.every(signal => signal.displayCategory === "rejected"));
  });
});
