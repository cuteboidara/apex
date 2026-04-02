import assert from "node:assert/strict";
import test from "node:test";

import { shouldIncludeOutcomeRow, type TradePlanOutcomeRow } from "@/src/application/analytics/alphaReport";
import { buildStoredShadowTradePlan, type ShadowTrackableCard } from "@/src/application/outcomes/shadowTracker";

function makeOutcomeRow(overrides: Partial<TradePlanOutcomeRow> = {}): TradePlanOutcomeRow {
  const now = new Date("2026-03-29T12:00:00.000Z");
  return {
    signalId: "sig_shadow_1",
    symbol: "XAUUSD",
    assetClass: "commodity",
    style: "INTRADAY",
    setupFamily: "macro_overlay",
    bias: "LONG",
    confidence: 58,
    publicationRank: "Silent",
    publicationStatus: "watchlist_only",
    providerAtSignal: "Yahoo",
    providerHealthStateAtSignal: "DEGRADED",
    providerFallbackUsedAtSignal: true,
    dataQuality: "fallback",
    regimeTag: "fallback",
    qualityGateReason: "publication:watchlist_only",
    outcome: null,
    detectedAt: now,
    entryHitAt: null,
    stopHitAt: null,
    tp1HitAt: null,
    tp2HitAt: null,
    tp3HitAt: null,
    invalidatedAt: null,
    expiredAt: null,
    realizedRR: null,
    maxFavorableExcursion: null,
    maxAdverseExcursion: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("shadow tracker preserves watchlist publication state and fallback data quality", () => {
  const card: ShadowTrackableCard = {
    assetClass: "commodity",
    marketSymbol: "XAUUSD",
    displayName: "Gold",
    direction: "buy",
    grade: "B",
    gradeScore: 68,
    confidence: 0.62,
    livePrice: 2185,
    entry: 2182,
    sl: 2164,
    tp1: 2210,
    tp2: 2234,
    tp3: 2255,
    setupType: "macro_overlay",
    location: "discount",
    marketPhase: "fallback",
    shortReasoning: "Fallback provider still supports a monitored setup.",
    detailedReasoning: "Fallback provider still supports a monitored setup.",
    publicationStatus: "watchlist_only",
    providerStatus: "fallback",
    priceSource: "yahoo",
    candleSource: "yahoo",
    fallbackDepth: 1,
    dataFreshnessMs: 18_000,
    dataTrustScore: 54,
    qualityScores: {
      structure: 61,
      market: 58,
      execution: 60,
      data: 48,
      assetFit: 59,
      composite: 57,
    },
    marketStateLabels: ["fallback active"],
    noTradeReason: "data fallback active",
    publicationReasons: ["FALLBACK_PROVIDER"],
  };

  const stored = buildStoredShadowTradePlan(card);

  assert.equal(stored.publicationStatus, "watchlist_only");
  assert.equal(stored.providerFallbackUsedAtSignal, true);
  assert.equal(stored.providerHealthStateAtSignal, "DEGRADED");
  assert.equal(stored.dataQuality, "fallback");
});

test("degraded outcome acceptance can include or exclude fallback samples explicitly", () => {
  const fallbackRow = makeOutcomeRow();

  assert.equal(shouldIncludeOutcomeRow(fallbackRow, { acceptDegradedOutcomes: true }), true);
  assert.equal(shouldIncludeOutcomeRow(fallbackRow, { acceptDegradedOutcomes: false }), false);
  assert.equal(
    shouldIncludeOutcomeRow(makeOutcomeRow({ dataQuality: "healthy", providerFallbackUsedAtSignal: false }), { acceptDegradedOutcomes: false }),
    true,
  );
});
