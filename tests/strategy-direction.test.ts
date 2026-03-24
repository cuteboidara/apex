import assert from "node:assert/strict";
import test from "node:test";

import { calculateTradeLevels } from "@/lib/levelCalculator";
import { calculateRiskRewardRatio } from "@/lib/riskModel";
import { publishStrategyPlan } from "@/lib/strategy/signalPublisher";
import type { MarketSnapshot } from "@/lib/strategy/types";

function providerState(
  marketStatus: "LIVE" | "DEGRADED" | "UNAVAILABLE" = "LIVE",
  fallbackUsed = false,
  selectedProvider = "Test"
) {
  return {
    selectedProvider,
    fallbackUsed,
    freshnessMs: 1_000,
    marketStatus,
    reason: marketStatus === "LIVE" ? null : "provider degraded",
  };
}

function makeSnapshot(overrides: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    symbol: "TEST",
    assetClass: "FOREX",
    preferredBias: "LONG",
    currentPrice: 99,
    change24h: 0.4,
    high14d: 102,
    low14d: 96,
    trend: "uptrend",
    rsi: 58,
    stale: false,
    marketStatus: "LIVE",
    providerFallbackUsed: false,
    styleReadiness: {
      SCALP: { ready: true, missing: [], stale: [] },
      INTRADAY: { ready: true, missing: [], stale: [] },
      SWING: { ready: true, missing: [], stale: [] },
    },
    candleProviders: {
      "1m": providerState(),
      "5m": providerState(),
      "15m": providerState(),
      "1h": providerState(),
      "4h": providerState(),
      "1D": providerState(),
    },
    newsSentimentScore: 0,
    macroBias: "risk_on",
    brief: "Test snapshot",
    ...overrides,
  };
}

test("SCALP publication is no longer hard-disabled when Yahoo intraday data is live", () => {
  const plan = publishStrategyPlan("SCALP", makeSnapshot({
    candleProviders: {
      "1m": providerState("LIVE", false, "Yahoo Finance"),
      "5m": providerState("LIVE", false, "Yahoo Finance"),
      "15m": providerState("LIVE", false, "Yahoo Finance"),
      "1h": providerState("LIVE", false, "Yahoo Finance"),
      "4h": providerState("LIVE", false, "Yahoo Finance"),
      "1D": providerState("LIVE", false, "Yahoo Finance"),
    },
  }));

  assert.equal(plan.status, "NO_SETUP");
  assert.ok(!plan.diagnostics.includes("style_disabled"));
  assert.doesNotMatch(plan.thesis, /daily only/i);
  assert.equal(plan.entryType, "NONE");
});

test("valid bullish INTRADAY setup can publish", () => {
  const plan = publishStrategyPlan("INTRADAY", makeSnapshot({
    preferredBias: "LONG",
    currentPrice: 91.2,
    high14d: 97,
    low14d: 90,
    change24h: 0.08,
    trend: "uptrend",
    rsi: 58,
    macroBias: "risk_on",
  }));

  assert.equal(plan.status, "ACTIVE");
  assert.equal(plan.bias, "LONG");
  assert.ok(plan.setupFamily != null);
  assert.ok(plan.entryMin != null);
  assert.ok(plan.entryMax != null);
  assert.ok(plan.stopLoss != null);
  assert.ok(plan.takeProfit1 != null);
  assert.ok(plan.riskRewardRatio != null && plan.riskRewardRatio >= 2);
  assert.deepEqual(plan.diagnostics, []);
});

test("valid bearish SWING setup can publish", () => {
  const plan = publishStrategyPlan("SWING", makeSnapshot({
    preferredBias: "SHORT",
    currentPrice: 108.8,
    high14d: 110,
    low14d: 103,
    change24h: -0.08,
    trend: "downtrend",
    rsi: 42,
    macroBias: "risk_off",
  }));

  assert.equal(plan.status, "ACTIVE");
  assert.equal(plan.bias, "SHORT");
  assert.ok(plan.setupFamily != null);
  assert.ok(plan.entryMin != null);
  assert.ok(plan.entryMax != null);
  assert.ok(plan.stopLoss != null);
  assert.ok(plan.takeProfit1 != null);
  assert.ok(plan.riskRewardRatio != null && plan.riskRewardRatio >= 2);
  assert.deepEqual(plan.diagnostics, []);
});

test("weak mid-range setup is rejected", () => {
  const plan = publishStrategyPlan("INTRADAY", makeSnapshot({
    preferredBias: "LONG",
    currentPrice: 99,
    high14d: 102,
    low14d: 96,
    change24h: 0.05,
    trend: "consolidation",
    rsi: 51,
    macroBias: "neutral",
  }));

  assert.equal(plan.status, "NO_SETUP");
  assert.ok(plan.diagnostics.includes("weak_location") || plan.diagnostics.includes("no_confirmation"));
  assert.equal(plan.entryType, "NONE");
});

test("Yahoo intraday-ready data does not promote a daily-only fallback setup without confirmation", () => {
  const plan = publishStrategyPlan("INTRADAY", makeSnapshot({
    preferredBias: "LONG",
    currentPrice: 91.2,
    high14d: 97,
    low14d: 90,
    change24h: 0.2,
    trend: "uptrend",
    rsi: 57,
    macroBias: "risk_on",
    candleProviders: {
      "1m": providerState("LIVE", false, "Yahoo Finance"),
      "5m": providerState("LIVE", false, "Yahoo Finance"),
      "15m": providerState("LIVE", false, "Yahoo Finance"),
      "1h": providerState("LIVE", false, "Yahoo Finance"),
      "4h": providerState("LIVE", false, "Yahoo Finance"),
      "1D": providerState("LIVE", false, "Yahoo Finance"),
    },
  }));

  assert.equal(plan.status, "NO_SETUP");
  assert.ok(plan.diagnostics.includes("no_confirmation"));
  assert.equal(plan.entryType, "NONE");
});

test("degraded required data blocks publication", () => {
  const plan = publishStrategyPlan("INTRADAY", makeSnapshot({
    styleReadiness: {
      SCALP: { ready: true, missing: [], stale: [] },
      INTRADAY: { ready: false, missing: [], stale: ["15m"] },
      SWING: { ready: true, missing: [], stale: [] },
    },
    candleProviders: {
      "1m": providerState(),
      "5m": providerState(),
      "15m": providerState("DEGRADED", true),
      "1h": providerState(),
      "4h": providerState(),
      "1D": providerState(),
    },
  }));

  assert.equal(plan.status, "STALE");
  assert.ok(plan.diagnostics.includes("degraded_data"));
  assert.equal(plan.entryType, "NONE");
});

test("SHORT trade math keeps entries, stops, targets, and invalidation ordered correctly", () => {
  const levels = calculateTradeLevels({
    bias: "SHORT",
    currentPrice: 101,
    high14d: 110,
    low14d: 100,
    volatilityRatio: 0.1,
    style: "INTRADAY",
    entryType: "STOP",
    localInvalidationLow: 100.8,
    localInvalidationHigh: 102.2,
    allowTp2: true,
    allowTp3: true,
  });

  assert.ok(levels);
  if (!levels) return;

  const averageEntry = (levels.entryMin + levels.entryMax) / 2;
  const rr = calculateRiskRewardRatio(averageEntry, levels.stopLoss, levels.takeProfit1);

  assert.ok(levels.entryMin < levels.entryMax);
  assert.ok(levels.stopLoss > averageEntry);
  assert.ok(levels.invalidationLevel >= levels.entryMax);
  assert.ok(levels.stopLoss > levels.invalidationLevel);
  assert.ok(levels.takeProfit1 < averageEntry);
  assert.ok(levels.takeProfit2 == null || levels.takeProfit2 < levels.takeProfit1);
  assert.ok(levels.takeProfit3 == null || (levels.takeProfit2 != null && levels.takeProfit3 < levels.takeProfit2));
  assert.ok(levels.riskUnit > 0);
  assert.equal(rr, 2);
});
