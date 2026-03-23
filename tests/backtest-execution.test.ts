import assert from "node:assert/strict";
import test from "node:test";

import { buildBacktestReport } from "@/lib/backtest/reporting";
import { simulateTradeExecution } from "@/lib/backtest/executionSimulator";

test("execution simulator resolves a long trade at TP1 when price reaches target before stop", () => {
  const result = simulateTradeExecution(
    {
      symbol: "EURUSD",
      assetClass: "FOREX",
      style: "INTRADAY",
      setupFamily: "Breakout Acceptance",
      regimeTag: "trend",
      provider: "Yahoo Finance",
      confidence: 82,
      bias: "LONG",
      timeframe: "15m",
      entryMin: 99,
      entryMax: 101,
      stopLoss: 95,
      takeProfit1: 105,
      takeProfit2: 110,
      takeProfit3: 115,
    },
    [
      { timestamp: 1, open: 100, high: 101, low: 99.4, close: 100.6, volume: null },
      { timestamp: 2, open: 100.6, high: 105.4, low: 100.2, close: 104.8, volume: null },
    ]
  );

  assert.equal(result.outcome, "TP1");
  assert.ok((result.realizedRR ?? 0) > 0);
});

test("backtest report aggregates expectancy and calibration", () => {
  const report = buildBacktestReport([
    {
      symbol: "EURUSD",
      assetClass: "FOREX",
      style: "INTRADAY",
      setupFamily: "Breakout Acceptance",
      regimeTag: "trend",
      provider: "Yahoo Finance",
      confidence: 82,
      bias: "LONG",
      outcome: "TP1",
      entryTimestamp: 1,
      exitTimestamp: 2,
      entryPrice: 100,
      exitPrice: 104,
      realizedRR: 1,
      realizedPnl: 4,
      maxFavorableExcursion: 1.3,
      maxAdverseExcursion: 0.2,
      candlesHeld: 2,
    },
    {
      symbol: "EURUSD",
      assetClass: "FOREX",
      style: "INTRADAY",
      setupFamily: "Breakout Acceptance",
      regimeTag: "trend",
      provider: "Yahoo Finance",
      confidence: 78,
      bias: "LONG",
      outcome: "STOP",
      entryTimestamp: 3,
      exitTimestamp: 4,
      entryPrice: 102,
      exitPrice: 100,
      realizedRR: -1,
      realizedPnl: -2,
      maxFavorableExcursion: 0.4,
      maxAdverseExcursion: 1,
      candlesHeld: 2,
    },
  ]);

  assert.equal(report.sampleSize, 2);
  assert.equal(report.byProvider[0]?.key, "Yahoo Finance");
  assert.ok(report.calibration.length > 0);
});
