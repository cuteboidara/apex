import assert from "node:assert/strict";
import test from "node:test";

import type { MTFCandles, MTFAnalysisResult } from "@/src/assets/shared/mtfAnalysis";
import { normalizeFxFallbackAnalysis } from "@/src/application/cycle/runCycle";

function makeCandles(length: number, start = 1): MTFCandles["h1"] {
  return Array.from({ length }, (_, index) => {
    const base = start + (index * 0.001);
    return {
      time: (index + 1) * 60_000,
      open: base,
      high: base + 0.0012,
      low: base - 0.001,
      close: base + 0.0004,
      volume: 1_000 + index,
    };
  });
}

function makeMtfCandles(): MTFCandles {
  const h1 = makeCandles(80, 1.1);
  return {
    monthly: makeCandles(24, 1.0),
    weekly: makeCandles(52, 1.02),
    daily: makeCandles(120, 1.04),
    h4: makeCandles(90, 1.06),
    h1,
    m15: makeCandles(120, 1.08),
    m5: makeCandles(180, 1.09),
  };
}

test("normalizeFxFallbackAnalysis preserves structure-based targets and only formats FX precision", () => {
  const analysis: MTFAnalysisResult = {
    monthlyBias: "bullish",
    weeklyBias: "bullish",
    dailyBias: "bullish",
    h4Bias: "bullish",
    h1Bias: "bullish",
    overallBias: "bullish",
    biasStrength: 80,
    orderBlocks: [],
    fvgs: [],
    breakerBlocks: [],
    liquiditySweeps: [],
    sdZones: [],
    premiumDiscount: {
      equilibrium: 1.11,
      rangeHigh: 1.13,
      rangeLow: 1.09,
      zone: "discount",
      pct: 28,
    },
    structureBreaks: [],
    entryConfluence: 30,
    entryTrigger: "fvg_fill",
    direction: "LONG",
    confidence: 72,
    grade: "A",
    entry: 1.11234,
    stopLoss: 1.11084,
    takeProfit: 1.112646,
    riskReward: 3.2,
    reasoning: "GBPUSD LONG: HTF bullish bias aligned with a confirmed liquidity sweep entry.",
    timeframe: "15m",
    setupType: "liquidity_sweep_reversal",
    takeProfit2: 1.116789,
    riskReward2: 5.6,
    entryTimeframe: "5m",
    htfBiasSummary: "Daily and H4 remain bullish with demand intact below price.",
    liquiditySweepDescription: "Sell-side liquidity below the prior 15m low was swept before a 5m bullish confirmation.",
    confluenceScore: 86,
  };

  const normalized = normalizeFxFallbackAnalysis({
    symbol: "GBPUSD",
    analysis,
    mtfCandles: makeMtfCandles(),
  });

  assert.equal(normalized.direction, "LONG");
  assert.equal(normalized.grade, analysis.grade);
  assert.equal(normalized.riskReward, analysis.riskReward);
  assert.equal(normalized.riskReward2, analysis.riskReward2);
  assert.equal(normalized.timeframe, analysis.timeframe);
  assert.equal(normalized.entryTimeframe, analysis.entryTimeframe);
  assert.equal(normalized.reasoning, analysis.reasoning);
  assert.equal(normalized.takeProfit, 1.11265);
  assert.equal(normalized.takeProfit2, 1.11679);
});

test("normalizeFxFallbackAnalysis leaves neutral MTF reads unchanged", () => {
  const analysis: MTFAnalysisResult = {
    monthlyBias: "ranging",
    weeklyBias: "ranging",
    dailyBias: "ranging",
    h4Bias: "ranging",
    h1Bias: "ranging",
    overallBias: "ranging",
    biasStrength: 40,
    orderBlocks: [],
    fvgs: [],
    breakerBlocks: [],
    liquiditySweeps: [],
    sdZones: [],
    premiumDiscount: {
      equilibrium: 1.2,
      rangeHigh: 1.22,
      rangeLow: 1.18,
      zone: "equilibrium",
      pct: 50,
    },
    structureBreaks: [],
    entryConfluence: 0,
    entryTrigger: "none",
    direction: "NEUTRAL",
    confidence: 40,
    grade: "F",
    entry: 1.2,
    stopLoss: 1.2,
    takeProfit: 1.2,
    riskReward: 0,
    reasoning: "No clear bias.",
    timeframe: "1h",
    setupType: "trend_pullback",
  };

  const normalized = normalizeFxFallbackAnalysis({
    symbol: "EURUSD",
    analysis,
    mtfCandles: makeMtfCandles(),
  });

  assert.deepEqual(normalized, analysis);
});
