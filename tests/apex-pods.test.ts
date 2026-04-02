import assert from "node:assert/strict";
import test from "node:test";

import type { FeatureSnapshot } from "@/src/interfaces/contracts";
import { TrendPod } from "@/src/pods/trend/TrendPod";
import { MeanReversionPod } from "@/src/pods/mean-reversion/MeanReversionPod";

const bullishSnapshot: FeatureSnapshot = {
  snapshot_id: "snap_bull",
  ts: Date.now(),
  symbol_canonical: "EURUSD",
  horizon: "15m",
  features: {
    ema_9: 1.12,
    ema_21: 1.08,
    price_momentum_1h: 0.03,
    price_momentum_4h: 0.05,
    atr_14: 0.01,
    volatility_regime: 0,
  },
  quality: {
    staleness_ms: 100,
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
      hourBucket: 10,
      minutesSinceSessionOpen: 180,
    },
    economic_event: {
      majorNewsFlag: false,
      minutesToNextHighImpactEvent: null,
      minutesSinceLastHighImpactEvent: null,
      eventType: null,
    },
  },
};

const meanReversionSnapshot: FeatureSnapshot = {
  snapshot_id: "snap_mr",
  ts: Date.now(),
  symbol_canonical: "EURUSD",
  horizon: "15m",
  features: {
    bollinger_pct_b: 0.12,
    rsi_14: 29,
    volatility_regime: 1,
  },
  quality: {
    staleness_ms: 100,
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
      hourBucket: 10,
      minutesSinceSessionOpen: 180,
    },
    economic_event: {
      majorNewsFlag: false,
      minutesToNextHighImpactEvent: null,
      minutesSinceLastHighImpactEvent: null,
      eventType: null,
    },
  },
};

test("trend pod emits long when fast EMA leads with positive momentum", async () => {
  const pod = new TrendPod();
  const output = await pod.evaluate(bullishSnapshot);
  assert.equal(output.recommended_action, "long");
  assert.ok(output.confidence > 0.5);
});

test("mean reversion pod emits long when Bollinger %B and RSI are oversold", async () => {
  const pod = new MeanReversionPod();
  const output = await pod.evaluate(meanReversionSnapshot);
  assert.equal(output.recommended_action, "long");
  assert.ok(output.confidence > 0.4);
});
