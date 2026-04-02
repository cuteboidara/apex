import assert from "node:assert/strict";
import test from "node:test";

import type { ApexConfig } from "@/src/lib/config";
import {
  assessTraderSignalGrade,
  buildTraderDashboardSignal,
  buildTraderSignalsPayload,
  formatTraderTelegramSignal,
  shouldSendTraderTelegramSignal,
} from "@/src/lib/trader";
import { formatMarketCardTelegramSignal, shouldSendMarketCardTelegramSignal } from "@/src/lib/telegram";
import type {
  AllocationIntent,
  FeatureSnapshot,
  RiskDecision,
  SignalLifecycleRecord,
} from "@/src/interfaces/contracts";

const CONFIG = {
  pairProfiles: {
    EURUSD: {
      minConfidence: 0.58,
      minRiskReward: 1.8,
      allowedSessions: ["london", "new_york"],
      preferredSessions: ["london", "new_york"],
      avoidSessions: ["asia", "off_hours"],
      maxSignalsPerDay: 4,
      cooldownMinutes: 45,
      atrToleranceMultiplier: 1,
    },
    GBPUSD: {
      minConfidence: 0.6,
      minRiskReward: 1.8,
      allowedSessions: ["london", "new_york"],
      preferredSessions: ["london", "new_york"],
      avoidSessions: ["asia", "off_hours"],
      maxSignalsPerDay: 4,
      cooldownMinutes: 45,
      atrToleranceMultiplier: 1,
    },
  },
} satisfies Pick<ApexConfig, "pairProfiles">;

function makeSnapshot(symbol = "EURUSD"): FeatureSnapshot {
  return {
    snapshot_id: `snap_${symbol}`,
    ts: 1,
    symbol_canonical: symbol,
    horizon: "15m",
    features: {
      mid: 1.085,
      ema_9: 1.0848,
      ema_21: 1.0842,
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
  const tradePlan = {
    entry: 1.0845,
    sl: 1.0815,
    tp1: 1.09,
    tp2: 1.092,
    tp3: 1.094,
    risk_reward_ratio: 1.83,
    entry_zone: {
      low: 1.084,
      high: 1.085,
      label: "EMA pullback zone",
    },
    invalidation_zone: {
      low: 1.081,
      high: 1.082,
      label: "Structure invalidation",
    },
    pre_entry_invalidation: "Cancel if price closes below structure before entry triggers.",
    post_entry_invalidation: "Exit if price closes below the invalidation zone after activation.",
    expires_after_bars: 3,
    expires_at: 9_000_000,
  };

  return {
    candidate_id: `sig_${symbol}`,
    ts: 1,
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
    trade_plan: tradePlan,
    entry: tradePlan.entry,
    sl: tradePlan.sl,
    tp1: tradePlan.tp1,
    tp2: tradePlan.tp2,
    tp3: tradePlan.tp3,
    target_position: 0.15,
    reasoning: ["Bullish trend continuation."],
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

function makeRiskDecision(overrides: Partial<RiskDecision> = {}): RiskDecision {
  return {
    ts: 1,
    scope: "EURUSD",
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

function makeLifecycle(signalId = "sig_EURUSD", symbol = "EURUSD", overrides: Partial<SignalLifecycleRecord> = {}): SignalLifecycleRecord {
  return {
    signal_id: signalId,
    symbol_canonical: symbol,
    direction: "buy",
    timeframe: "15m",
    entry_style: "trend_pullback",
    created_ts: 1,
    updated_ts: 2,
    expires_at: 9_000_000,
    state: "activated",
    outcome: "open",
    entry: 1.0845,
    sl: 1.0815,
    tp1: 1.09,
    tp2: 1.092,
    tp3: 1.094,
    max_favorable_excursion: 0.001,
    max_adverse_excursion: 0.0005,
    events: [],
    ...overrides,
  };
}

test("grade mapping promotes clean structure and penalizes blocked setups", () => {
  const strong = assessTraderSignalGrade({
    candidate: makeCandidate(),
    snapshot: makeSnapshot(),
    riskDecision: makeRiskDecision(),
    direction: "long",
    bias: "bullish",
    structure: "BOS",
    location: "discount",
    zoneType: "demand",
    config: CONFIG,
  });
  const blocked = assessTraderSignalGrade({
    candidate: makeCandidate("EURUSD", {
      direction: "none",
      confidence: 0.62,
      trade_plan: null,
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      tp3: null,
      veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
    }),
    snapshot: makeSnapshot(),
    riskDecision: makeRiskDecision({
      approval_status: "rejected",
      veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
    }),
    direction: "neutral",
    bias: "neutral",
    structure: "range",
    location: "neutral",
    zoneType: "neutral",
    config: CONFIG,
  });

  assert.equal(strong.grade, "S");
  assert.equal(blocked.grade, "F");
});

test("trader-facing signal card generation builds readable setup fields", () => {
  const card = buildTraderDashboardSignal({
    symbol: "EURUSD",
    snapshot: makeSnapshot(),
    candidate: makeCandidate(),
    riskDecision: makeRiskDecision(),
    lifecycle: makeLifecycle(),
    config: CONFIG,
  });

  assert.equal(card.symbol, "EURUSD");
  assert.equal(card.grade, "S");
  assert.equal(card.direction, "long");
  assert.equal(card.setupType, "continuation after BOS");
  assert.equal(card.bias, "bullish");
  assert.equal(card.structure, "BOS");
  assert.equal(card.location, "discount");
  assert.equal(card.zoneType, "demand");
  assert.equal(card.status, "active");
  assert.equal(card.noTradeReason, null);
  assert.ok(card.marketStateLabels.includes("active session"));
  assert.match(card.marketStructureSummary, /Bullish bias/i);
  assert.match(card.keyLevelsSummary, /PDH/i);
});

test("telegram formatting uses grades and only includes B when configured", () => {
  const strongCard = buildTraderDashboardSignal({
    symbol: "EURUSD",
    snapshot: makeSnapshot(),
    candidate: makeCandidate(),
    riskDecision: makeRiskDecision(),
    lifecycle: makeLifecycle(),
    config: CONFIG,
  });
  const bCard = buildTraderDashboardSignal({
    symbol: "EURUSD",
    snapshot: makeSnapshot(),
    candidate: makeCandidate("EURUSD", {
      confidence: 0.7,
      trade_plan: {
        ...makeCandidate().trade_plan!,
        risk_reward_ratio: 1.7,
      },
      tp2: 1.091,
      tp3: 1.092,
    }),
    riskDecision: makeRiskDecision({
      approval_status: "approved_reduced",
      warning_reasons: ["VOL_TOO_LOW"],
    }),
    lifecycle: makeLifecycle(),
    config: CONFIG,
  });
  const message = formatTraderTelegramSignal(strongCard);

  assert.match(message, /EURUSD • LONG • S/);
  assert.match(message, /Live price:/);
  assert.match(message, /Entry:/);
  assert.match(message, /SL:/);
  assert.match(message, /TP1:/);
  assert.match(message, /TP2:/);
  assert.match(message, /Session: London/);
  assert.equal(shouldSendTraderTelegramSignal(strongCard, { minimumTelegramGrade: "A", includeBTelegramSignals: false }), true);
  assert.equal(bCard.grade, "B");
  assert.equal(shouldSendTraderTelegramSignal(bCard, { minimumTelegramGrade: "B", includeBTelegramSignals: false }), false);
  assert.equal(shouldSendTraderTelegramSignal(bCard, { minimumTelegramGrade: "B", includeBTelegramSignals: true }), true);
});

test("market-card telegram delivery only auto-alerts S/A-grade cards and includes top-down context", () => {
  const bGradeStockCard = {
    id: "vm-stock-aapl",
    signal_id: null,
    marketSymbol: "AAPL",
    displayName: "AAPL",
    direction: "buy",
    grade: "B",
    status: "watchlist",
    displayCategory: "monitored",
    livePrice: 212.34,
    entry: 212.34,
    sl: 208.12,
    tp1: 220.78,
    tp2: 224.1,
    tp3: null,
    setupType: "trend pullback",
    shortReasoning: "AAPL is trending higher with supportive structure.",
    marketStateLabels: ["Market Open", "US large cap"],
    noTradeReason: null,
  } as const;
  const aGradeStockCard = {
    ...bGradeStockCard,
    grade: "A",
    entryTimeframe: "5m",
    tp1RiskReward: 3.4,
    tp2RiskReward: 5.2,
    htfBiasSummary: "Daily and H4 structure remain bullish with price reacting from demand.",
    liquiditySweepDescription: "Sell-side liquidity below the prior intraday low was swept before the 5m bullish engulfing close.",
    confluenceScore: 88,
  } as const;

  assert.equal(
    shouldSendMarketCardTelegramSignal(bGradeStockCard, { minimumTelegramGrade: "B", includeBTelegramSignals: true }),
    false,
  );
  assert.equal(
    shouldSendMarketCardTelegramSignal(aGradeStockCard, { minimumTelegramGrade: "B", includeBTelegramSignals: false }),
    true,
  );
  assert.equal(
    shouldSendMarketCardTelegramSignal({ ...aGradeStockCard, direction: "neutral" }, { minimumTelegramGrade: "B", includeBTelegramSignals: true }),
    false,
  );

  const message = formatMarketCardTelegramSignal(aGradeStockCard, "Stocks");
  assert.match(message, /APEX STOCKS — AAPL/);
  assert.match(message, /AAPL • LONG • A/);
  assert.match(message, /Status: WATCHLIST/);
  assert.match(message, /Entry confirmation: 5m/);
  assert.match(message, /Entry:/);
  assert.match(message, /TP1: 220\.7800 \(3\.40R\)/);
  assert.match(message, /TP2: 224\.1000 \(5\.20R\)/);
  assert.match(message, /Confluence: 88\/100/);
  assert.match(message, /HTF Bias: Daily and H4 structure remain bullish/i);
  assert.match(message, /Sweep: Sell-side liquidity below the prior intraday low/i);
});

test("market-card telegram delivery rejects B-grade forex cards and formats A-grade forex alerts", () => {
  const forexCard = {
    id: "vm-forex-eurusd",
    signal_id: "sig-eurusd",
    marketSymbol: "EURUSD",
    displayName: "EUR/USD",
    direction: "buy",
    grade: "A",
    status: "watchlist",
    displayCategory: "monitored",
    livePrice: 1.08456,
    entry: 1.0845,
    sl: 1.0812,
    tp1: 1.091,
    tp2: 1.0935,
    tp3: null,
    setupType: "liquidity sweep reversal",
    shortReasoning: "EURUSD completed a sell-side sweep into aligned higher-timeframe demand.",
    marketStateLabels: ["London", "active session"],
    noTradeReason: null,
    entryTimeframe: "15m",
    tp1RiskReward: 3.2,
    tp2RiskReward: 4.9,
    htfBiasSummary: "Daily and H4 remain bullish with higher lows holding above demand.",
    liquiditySweepDescription: "Price swept the prior London-session low before a 15m bullish confirmation close.",
    confluenceScore: 84,
  } as const;

  assert.equal(
    shouldSendMarketCardTelegramSignal({ ...forexCard, grade: "B" }, { minimumTelegramGrade: "B", includeBTelegramSignals: true }),
    false,
  );
  assert.equal(
    shouldSendMarketCardTelegramSignal(forexCard, { minimumTelegramGrade: "B", includeBTelegramSignals: true }),
    true,
  );

  const message = formatMarketCardTelegramSignal(forexCard, "Forex");
  assert.match(message, /APEX FOREX — EUR\/USD/);
  assert.match(message, /EURUSD • LONG • A/);
  assert.match(message, /Status: WATCHLIST/);
  assert.match(message, /Entry confirmation: 15m/);
  assert.match(message, /TP1: 1\.0910 \(3\.20R\)/);
  assert.match(message, /TP2: 1\.0935 \(4\.90R\)/);
  assert.match(message, /HTF Bias: Daily and H4 remain bullish/i);
  assert.match(message, /Sweep: Price swept the prior London-session low/i);
});

test("simplified dashboard payload separates live board, active signals, reasoning, key areas, and analysis states", () => {
  const blockedCandidate = makeCandidate("GBPUSD", {
    symbol_canonical: "GBPUSD",
    candidate_id: "sig_GBPUSD",
    direction: "none",
    confidence: 0,
    trade_plan: null,
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    tp3: null,
    veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
  });
  const payload = buildTraderSignalsPayload({
    activeSymbols: ["EURUSD", "GBPUSD"],
    candidates: [
      makeCandidate("EURUSD"),
      blockedCandidate,
    ],
    snapshots: [
      makeSnapshot("EURUSD"),
      {
        ...makeSnapshot("GBPUSD"),
        symbol_canonical: "GBPUSD",
      },
    ],
    riskDecisions: [
      makeRiskDecision({ scope: "EURUSD" }),
      makeRiskDecision({ scope: "GBPUSD", approval_status: "rejected", veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"] }),
    ],
    lifecycles: [
      makeLifecycle("sig_EURUSD", "EURUSD"),
    ],
    preferences: {
      meaningfulSignalFloor: "B",
      minimumTelegramGrade: "A",
      includeBTelegramSignals: false,
      showBlockedSignalsOnMainDashboard: false,
      showAdvancedInternals: false,
    },
    config: CONFIG,
  });

  assert.equal(payload.liveMarketBoard.length, 2);
  assert.deepEqual(payload.activeSignals.map(card => card.symbol), ["EURUSD"]);
  assert.deepEqual(payload.developingSetups.map(card => card.symbol), ["GBPUSD"]);
  assert.deepEqual(payload.blockedSignals.map(card => card.symbol), []);
  assert.deepEqual(payload.watchlistSignals.map(card => card.symbol), ["GBPUSD"]);
  assert.equal(payload.marketReasoning.length, 2);
  assert.equal(payload.keyAreas.length, 2);
  assert.equal(payload.marketReasoning.find(row => row.symbol === "GBPUSD")?.noTradeReason, "awaiting setup");
  assert.ok(payload.liveMarketBoard.find(row => row.symbol === "EURUSD")?.marketStateLabels.includes("active session"));
});

test("trader summaries stay neutral when structure fields are unavailable", () => {
  const neutralSnapshot: FeatureSnapshot = {
    ...makeSnapshot(),
    features: {
      mid: 1.085,
      ema_9: 1.085,
      ema_21: 1.085,
      atr_14: 0.002,
    },
    context: {
      timeframe: "15m",
      source: "synthetic",
      quality_flag: "clean",
      session: {
        session: "overlap",
        tradingDay: "2026-03-25",
        hourBucket: 13,
        minutesSinceSessionOpen: 45,
      },
      economic_event: {
        majorNewsFlag: false,
        minutesToNextHighImpactEvent: null,
        minutesSinceLastHighImpactEvent: null,
        eventType: null,
      },
    },
  };
  const neutralCard = buildTraderDashboardSignal({
    symbol: "EURUSD",
    snapshot: neutralSnapshot,
    candidate: makeCandidate("EURUSD", {
      direction: "none",
      confidence: 0,
      trade_plan: null,
      entry: null,
      sl: null,
      tp1: null,
      tp2: null,
      tp3: null,
      veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
    }),
    riskDecision: makeRiskDecision({
      approval_status: "rejected",
      veto_reasons: ["NO_DIRECTIONAL_CONSENSUS"],
    }),
    lifecycle: null,
    config: CONFIG,
  });

  assert.equal(neutralCard.structure, "neutral");
  assert.equal(neutralCard.liquidityState, "neutral");
  assert.equal(neutralCard.location, "neutral");
  assert.equal(neutralCard.zoneType, "neutral");
  assert.equal(neutralCard.status, "watchlist");
  assert.equal(neutralCard.noTradeReason, "no structure");
  assert.match(neutralCard.shortReasoning, /analysis|watchlist/i);
  assert.equal(typeof neutralCard.detailedReasoning.whyThisLevel, "string");
});

test("directional setups rejected by risk are surfaced as blocked with readable reasons", () => {
  const blockedCard = buildTraderDashboardSignal({
    symbol: "EURUSD",
    snapshot: makeSnapshot(),
    candidate: makeCandidate("EURUSD", {
      confidence: 0.78,
    }),
    riskDecision: makeRiskDecision({
      approval_status: "rejected",
      veto_reasons: ["VOL_TOO_HIGH"],
    }),
    lifecycle: null,
    config: CONFIG,
  });

  const payload = buildTraderSignalsPayload({
    activeSymbols: ["EURUSD"],
    candidates: [makeCandidate("EURUSD", { confidence: 0.78 })],
    snapshots: [makeSnapshot("EURUSD")],
    riskDecisions: [makeRiskDecision({ approval_status: "rejected", veto_reasons: ["VOL_TOO_HIGH"] })],
    lifecycles: [],
    preferences: {
      meaningfulSignalFloor: "B",
      minimumTelegramGrade: "A",
      includeBTelegramSignals: false,
      showBlockedSignalsOnMainDashboard: false,
      showAdvancedInternals: false,
    },
    config: CONFIG,
  });

  assert.equal(blockedCard.status, "blocked");
  assert.equal(blockedCard.noTradeReason, "blocked by risk");
  assert.match(blockedCard.whyNotValid ?? "", /volatility is running too hot/i);
  assert.deepEqual(payload.blockedSignals.map(card => card.symbol), ["EURUSD"]);
});
