import assert from "node:assert/strict";
import test from "node:test";

import type { FeatureSnapshot } from "@/src/interfaces/contracts";
import { deriveSignalLevels } from "@/src/lib/signalLevels";

function makeSnapshot(overrides?: Partial<FeatureSnapshot["features"]>): FeatureSnapshot {
  return {
    snapshot_id: "snap_test",
    ts: 1,
    symbol_canonical: "EURUSD",
    horizon: "15m",
    features: {
      mid: 1.1,
      atr_14: 0.004,
      bollinger_upper: 1.112,
      bollinger_lower: 1.088,
      ema_9: 1.101,
      ema_21: 1.099,
      sma_20: 1.1,
      ...overrides,
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
}

test("deriveSignalLevels returns ordered long levels", () => {
  const levels = deriveSignalLevels(makeSnapshot(), "long");

  assert.ok(levels);
  assert.equal(levels.entry > levels.stop_loss, true);
  assert.equal(levels.tp1 > levels.entry, true);
  assert.equal(levels.tp2 == null || levels.tp2 > levels.tp1, true);
  assert.equal(levels.tp3 == null || (levels.tp2 != null && levels.tp3 > levels.tp2), true);
});

test("deriveSignalLevels returns ordered short levels", () => {
  const levels = deriveSignalLevels(makeSnapshot(), "short");

  assert.ok(levels);
  assert.equal(levels.entry < levels.stop_loss, true);
  assert.equal(levels.tp1 < levels.entry, true);
  assert.equal(levels.tp2 == null || levels.tp2 < levels.tp1, true);
  assert.equal(levels.tp3 == null || (levels.tp2 != null && levels.tp3 < levels.tp2), true);
});

test("deriveSignalLevels returns null for non-directional actions", () => {
  assert.equal(deriveSignalLevels(makeSnapshot(), "hold"), null);
});
