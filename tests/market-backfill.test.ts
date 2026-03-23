import assert from "node:assert/strict";
import test from "node:test";

import { chooseReplayCoverage } from "@/lib/marketData/backfill";
import { aggregateYahooCandles } from "@/lib/providers/yahooFinance";

test("replay coverage falls back to the provider with sufficient persisted history", () => {
  const coverage = chooseReplayCoverage(
    "5m",
    ["Yahoo Finance"],
    [
      {
        provider: "Legacy Provider",
        candleCount: 12,
        earliestTimestamp: Date.parse("2026-03-20T00:00:00.000Z"),
        latestTimestamp: Date.parse("2026-03-20T02:00:00.000Z"),
      },
      {
        provider: "Yahoo Finance",
        candleCount: 64,
        earliestTimestamp: Date.parse("2026-03-22T00:00:00.000Z"),
        latestTimestamp: Date.parse("2026-03-23T00:00:00.000Z"),
      },
    ],
    {
      minimumCandles: 30,
      end: new Date("2026-03-23T00:20:00.000Z"),
    }
  );

  assert.equal(coverage.provider, "Yahoo Finance");
  assert.equal(coverage.sufficient, true);
  assert.equal(coverage.reason, null);
});

test("yahoo 4h aggregation collapses 1h candles into deterministic 4h bars", () => {
  const candles = aggregateYahooCandles([
    { timestamp: Date.parse("2026-03-23T00:00:00.000Z"), open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
    { timestamp: Date.parse("2026-03-23T01:00:00.000Z"), open: 100.5, high: 102, low: 100, close: 101.2, volume: 20 },
    { timestamp: Date.parse("2026-03-23T02:00:00.000Z"), open: 101.2, high: 103, low: 100.8, close: 102.4, volume: 30 },
    { timestamp: Date.parse("2026-03-23T03:00:00.000Z"), open: 102.4, high: 104, low: 101.5, close: 103.8, volume: 40 },
  ], "4h");

  assert.equal(candles.length, 1);
  assert.deepEqual(candles[0], {
    timestamp: Date.parse("2026-03-23T00:00:00.000Z"),
    open: 100,
    high: 104,
    low: 99,
    close: 103.8,
    volume: 100,
  });
});
