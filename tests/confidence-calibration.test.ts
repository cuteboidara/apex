import assert from "node:assert/strict";
import test from "node:test";

import {
  buildConfidenceCalibrationBuckets,
  buildEvidenceGateRules,
  buildStrategyPerformanceWindows,
} from "@/lib/analysis/confidenceCalibration";

const records = [
  { symbol: "EURUSD", assetClass: "FOREX", style: "INTRADAY", setupFamily: "Breakout Acceptance", regimeTag: "trend", provider: "Yahoo Finance", providerHealthState: "HEALTHY", confidence: 82, realizedRR: -1.2 },
  { symbol: "EURUSD", assetClass: "FOREX", style: "INTRADAY", setupFamily: "Breakout Acceptance", regimeTag: "trend", provider: "Yahoo Finance", providerHealthState: "HEALTHY", confidence: 84, realizedRR: -0.6 },
  { symbol: "EURUSD", assetClass: "FOREX", style: "INTRADAY", setupFamily: "Breakout Acceptance", regimeTag: "trend", provider: "Yahoo Finance", providerHealthState: "HEALTHY", confidence: 86, realizedRR: -0.4 },
  { symbol: "EURUSD", assetClass: "FOREX", style: "INTRADAY", setupFamily: "Breakout Acceptance", regimeTag: "trend", provider: "Yahoo Finance", providerHealthState: "HEALTHY", confidence: 88, realizedRR: -0.2 },
  { symbol: "EURUSD", assetClass: "FOREX", style: "INTRADAY", setupFamily: "Breakout Acceptance", regimeTag: "trend", provider: "Yahoo Finance", providerHealthState: "HEALTHY", confidence: 90, realizedRR: -0.3 },
  { symbol: "EURUSD", assetClass: "FOREX", style: "INTRADAY", setupFamily: "Breakout Acceptance", regimeTag: "trend", provider: "Yahoo Finance", providerHealthState: "HEALTHY", confidence: 92, realizedRR: 0.1 },
];

test("confidence calibration buckets group by confidence bands", () => {
  const buckets = buildConfidenceCalibrationBuckets(records, { bucketSize: 10, scopeType: "GLOBAL" });
  assert.ok(buckets.length >= 2);
  assert.equal(buckets[0]?.confidenceMin, 80);
});

test("strategy windows summarize expectancy and drawdown", () => {
  const windows = buildStrategyPerformanceWindows(records);
  const symbolWindow = windows.find(window => window.scopeType === "SYMBOL_STYLE");
  assert.ok(symbolWindow);
  assert.ok((symbolWindow?.expectancy ?? 1) < 0);
  assert.ok((symbolWindow?.maxDrawdown ?? 0) <= 0);
});

test("evidence gate rules suppress weak scopes", () => {
  const rules = buildEvidenceGateRules(records, {
    minimumSampleSize: 5,
    minimumWinRate: 0.4,
    minimumExpectancy: 0,
  });
  assert.ok(rules.some(rule => rule.scopeType === "SYMBOL_STYLE"));
});
