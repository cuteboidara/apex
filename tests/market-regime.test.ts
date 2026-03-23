import assert from "node:assert/strict";
import test from "node:test";

import { assessMarketRegime } from "@/lib/analysis/marketRegime";
import type { MarketSnapshot } from "@/lib/strategy/types";

function snapshot(overrides: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    symbol: "EURUSD",
    assetClass: "FOREX",
    preferredBias: "LONG",
    currentPrice: 100,
    change24h: 0.2,
    high14d: 103,
    low14d: 97,
    trend: "consolidation",
    rsi: 52,
    stale: false,
    marketStatus: "LIVE",
    providerFallbackUsed: false,
    styleReadiness: {
      SCALP: { ready: true, missing: [], stale: [] },
      INTRADAY: { ready: true, missing: [], stale: [] },
      SWING: { ready: true, missing: [], stale: [] },
    },
    candleProviders: {},
    newsSentimentScore: 0,
    macroBias: "neutral",
    brief: "regime test",
    ...overrides,
  };
}

test("market regime classifies quiet compression", () => {
  const regime = assessMarketRegime(snapshot({
    change24h: 0.08,
    high14d: 100.8,
    low14d: 99.4,
  }));

  assert.equal(regime.tag, "compression");
  assert.equal(regime.family, "quiet");
});

test("market regime classifies trending breakout", () => {
  const regime = assessMarketRegime(snapshot({
    currentPrice: 118,
    change24h: 1.4,
    high14d: 120,
    low14d: 95,
    trend: "uptrend",
    rsi: 63,
    macroBias: "risk_on",
  }));

  assert.equal(regime.family, "breakout");
  assert.equal(regime.bias, "LONG");
});

test("market regime returns unclear on stale data", () => {
  const regime = assessMarketRegime(snapshot({
    stale: true,
  }));

  assert.equal(regime.tag, "unclear");
  assert.equal(regime.family, "unclear");
});
