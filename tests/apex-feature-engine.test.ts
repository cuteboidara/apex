import assert from "node:assert/strict";
import test from "node:test";

import { classifyFxSession } from "@/src/data-plant/session";
import { FeatureEngine } from "@/src/feature-engine/FeatureEngine";
import { ApexRepository } from "@/src/lib/repository";
import type { CanonicalMarketEvent, NormalizedCandle } from "@/src/interfaces/contracts";

function buildEvent(index: number, price: number): CanonicalMarketEvent {
  return {
    event_id: `evt_${index}`,
    ts_exchange: 1_710_000_000_000 + index * 60_000,
    ts_received: 1_710_000_000_000 + index * 60_000 + 150,
    venue: "synthetic",
    asset_class: "forex",
    symbol_raw: "EURUSD",
    symbol_canonical: "EURUSD",
    event_type: "ohlcv",
    sequence_number: index + 1,
    integrity_flags: [],
    price,
    size: 1000 + index,
    bid: price - 0.0002,
    ask: price + 0.0002,
    spread: 4,
  };
}

function buildCandle(index: number, baseTs: number, close: number): NormalizedCandle {
  const timestampOpen = baseTs + index * 15 * 60_000;
  const session = classifyFxSession(timestampOpen);
  return {
    symbol: "EURUSD",
    timeframe: "15m",
    open: close - 0.0004,
    high: close + 0.0007,
    low: close - 0.0008,
    close,
    volume: 1000 + index,
    timestampOpen,
    timestampClose: timestampOpen + 15 * 60_000,
    source: "synthetic",
    qualityFlag: "clean",
    ...session,
    majorNewsFlag: false,
    minutesToNextHighImpactEvent: null,
    minutesSinceLastHighImpactEvent: null,
    eventType: null,
  };
}

test("feature engine computes a complete snapshot from canonical events", async () => {
  const repository = new ApexRepository();
  const engine = new FeatureEngine(repository);

  for (let index = 0; index < 60; index += 1) {
    engine.consume(buildEvent(index, 1.08 + index * 0.0005));
  }

  const snapshot = engine.buildSnapshot("EURUSD", "15m");
  assert.ok(snapshot);
  assert.equal(snapshot?.symbol_canonical, "EURUSD");
  assert.ok(snapshot?.features.sma_20);
  assert.ok(snapshot?.features.ema_9);
  assert.ok(snapshot?.features.rsi_14 >= 0);
  assert.ok(snapshot?.features.atr_14 >= 0);
  assert.ok(snapshot?.features.bollinger_upper > snapshot!.features.bollinger_lower);
  assert.equal(typeof snapshot?.features.recent_swing_high, "number");
  assert.equal(typeof snapshot?.features.break_of_structure, "number");
  assert.equal(typeof snapshot?.features.distance_to_session_high, "number");
  assert.equal(typeof snapshot?.features.asia_range_size, "number");
  assert.equal(typeof snapshot?.features.tradeability_volatility_state, "number");
  assert.equal(typeof snapshot?.features.signal_crowding_same_pair, "number");
  assert.equal(typeof snapshot?.features.session_code, "number");
  assert.equal(typeof snapshot?.features.major_news_flag, "number");
  assert.ok(snapshot?.context.session.session);
  assert.ok(snapshot?.context.market_structure);
  assert.ok(snapshot?.context.session_features);
  assert.ok(snapshot?.context.tradeability);
  assert.ok(snapshot?.quality.completeness >= 0.9);
  assert.ok(snapshot?.quality.confidence > 0.5);
});

test("feature engine exposes session and previous-day range features from normalized candles", () => {
  const repository = new ApexRepository();
  const engine = new FeatureEngine(repository);
  const baseTs = Date.parse("2026-03-24T00:00:00.000Z");

  for (let index = 0; index < 140; index += 1) {
    engine.consume(buildCandle(index, baseTs, 1.08 + index * 0.0003));
  }

  const snapshot = engine.buildSnapshot("EURUSD", "15m");

  assert.ok(snapshot);
  assert.ok((snapshot?.features.asia_range_size ?? 0) > 0);
  assert.ok((snapshot?.features.london_range_size ?? 0) >= 0);
  assert.ok((snapshot?.features.distance_to_previous_day_high ?? 0) >= 0);
  assert.ok((snapshot?.features.atr_relative_to_normal ?? 0) > 0);
  assert.ok(snapshot?.context.session_features?.atrRelativeToNormal);
  assert.ok(snapshot?.context.market_structure?.structureBias);
  assert.ok(snapshot?.context.tradeability?.pairVolatilityRegime);
});
