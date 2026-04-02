import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCalibrationSummaryForAsset,
  buildGradeCalibrationRows,
  buildPerformanceSummaryForAsset,
  derivePromotionReadiness,
  type TradePlanOutcomeRow,
} from "@/src/application/analytics/alphaReport";
import type { ProviderReliabilitySummary } from "@/src/application/analytics/alphaTypes";

function makeOutcomeRow(overrides: Partial<TradePlanOutcomeRow> = {}): TradePlanOutcomeRow {
  const now = new Date("2026-03-29T12:00:00.000Z");
  return {
    signalId: "sig_1",
    symbol: "EURUSD",
    assetClass: "fx",
    style: "INTRADAY",
    setupFamily: "trend_pullback",
    bias: "LONG",
    confidence: 74,
    publicationRank: "A",
    publicationStatus: "publishable",
    providerAtSignal: "Yahoo Finance",
    providerHealthStateAtSignal: "HEALTHY",
    providerFallbackUsedAtSignal: false,
    dataQuality: "healthy",
    regimeTag: "trend",
    qualityGateReason: null,
    outcome: "TP1",
    detectedAt: now,
    entryHitAt: new Date("2026-03-29T12:10:00.000Z"),
    stopHitAt: null,
    tp1HitAt: new Date("2026-03-29T13:00:00.000Z"),
    tp2HitAt: null,
    tp3HitAt: null,
    invalidatedAt: null,
    expiredAt: null,
    realizedRR: 0.9,
    maxFavorableExcursion: 1.2,
    maxAdverseExcursion: 0.4,
    createdAt: now,
    updatedAt: new Date("2026-03-29T13:00:00.000Z"),
    ...overrides,
  };
}

test("alpha analytics summaries preserve sample size, expectancy, and calibration readiness", () => {
  const rows: TradePlanOutcomeRow[] = [
    ...Array.from({ length: 8 }, (_, index) => makeOutcomeRow({
      signalId: `sig_tp_${index}`,
      confidence: 70 + index,
      realizedRR: 1.1,
      tp1HitAt: new Date("2026-03-29T13:00:00.000Z"),
      outcome: "TP1",
    })),
    ...Array.from({ length: 4 }, (_, index) => makeOutcomeRow({
      signalId: `sig_stop_${index}`,
      confidence: 60 + index,
      realizedRR: -1,
      tp1HitAt: null,
      stopHitAt: new Date("2026-03-29T12:45:00.000Z"),
      outcome: "STOP",
    })),
  ];

  const performance = buildPerformanceSummaryForAsset("fx", rows);
  const calibration = buildCalibrationSummaryForAsset("fx", rows);
  const gradeRows = buildGradeCalibrationRows("fx", rows);

  assert.equal(performance.sampleSize, 12);
  assert.equal(performance.resolvedCount, 12);
  assert.equal(performance.triggeredCount, 12);
  assert.equal(performance.winRate, 0.667);
  assert.equal(performance.averageRealizedR, 0.4);

  assert.equal(calibration.calibrationSampleSize, 12);
  assert.equal(calibration.confidenceReliabilityBand, "low");
  assert.equal(calibration.calibrationState, "calibrated_and_trustworthy");
  assert.ok(calibration.buckets.length >= 2);

  assert.equal(gradeRows.length, 1);
  assert.equal(gradeRows[0]?.grade, "A");
  assert.equal(gradeRows[0]?.tp1Rate, 0.667);
  assert.equal(gradeRows[0]?.providerLimitedRate, 0);
});

test("promotion readiness downgrades provider-limited or broken runtime paths", () => {
  const calibration = buildCalibrationSummaryForAsset("commodity", Array.from({ length: 16 }, (_, index) => makeOutcomeRow({
    signalId: `commodity_${index}`,
    assetClass: "commodity",
    symbol: "XAUUSD",
    confidence: 68 + (index % 6),
    realizedRR: index < 10 ? 0.8 : -0.6,
    providerHealthStateAtSignal: index < 8 ? "DEGRADED" : "HEALTHY",
    providerFallbackUsedAtSignal: index < 8,
    outcome: index < 10 ? "TP1" : "STOP",
    tp1HitAt: index < 10 ? new Date("2026-03-29T13:10:00.000Z") : null,
    stopHitAt: index < 10 ? null : new Date("2026-03-29T12:50:00.000Z"),
  })));
  const performance = buildPerformanceSummaryForAsset("commodity", Array.from({ length: 16 }, (_, index) => makeOutcomeRow({
    signalId: `commodity_perf_${index}`,
    assetClass: "commodity",
    symbol: "XAUUSD",
    providerHealthStateAtSignal: index < 8 ? "DEGRADED" : "HEALTHY",
    providerFallbackUsedAtSignal: index < 8,
    realizedRR: index < 10 ? 0.8 : -0.6,
    outcome: index < 10 ? "TP1" : "STOP",
    tp1HitAt: index < 10 ? new Date("2026-03-29T13:10:00.000Z") : null,
    stopHitAt: index < 10 ? null : new Date("2026-03-29T12:50:00.000Z"),
  })));

  const degraded = derivePromotionReadiness({
    assetClass: "commodity",
    smoke: {
      assetClass: "commodity",
      timestamp: Date.now(),
      runtimeHealth: "degraded",
      providerChain: ["Yahoo"],
      providersObserved: ["Yahoo"],
      providerStatus: "fallback",
      stageCounts: {
        symbolsAttempted: 5,
        marketSnapshotCount: 5,
        tradeCandidateCount: 5,
        riskEvaluatedCandidateCount: 5,
        executableSignalCount: 1,
        publishedCount: 0,
        blockedCount: 4,
      },
      nullPriceCount: 0,
      staleCount: 0,
      averageFreshnessMs: 6_000,
      worstFreshnessMs: 10_000,
      publicationDistribution: { publishable: 0, watchlist_only: 1, shadow_only: 2, blocked: 2 },
      rejectionReasons: {},
      notes: ["fallback provider in use"],
    },
    calibration,
    performance,
    providerReliability: [{
      provider: "Yahoo",
      assetClass: "commodity",
      attempts: 20,
      successes: 12,
      degradedResponses: 6,
      emptyBodyResponses: 0,
      averageLatencyMs: 450,
      successRate: 0.6,
      baseScore: 42,
      recentScore: 38,
      outcomeSampleSize: 16,
      averageRealizedR: 0.25,
      positiveExpectancyRate: 0.5,
      outcomeAdjustedScore: 38,
      lastRecordedAt: "2026-03-29T12:00:00.000Z",
      lastSuccessfulAt: "2026-03-29T11:55:00.000Z",
    }] satisfies ProviderReliabilitySummary[],
  });

  assert.equal(degraded.promotionState, "provider_limited");

  const broken = derivePromotionReadiness({
    assetClass: "stock",
    smoke: {
      assetClass: "stock",
      timestamp: Date.now(),
      runtimeHealth: "broken",
      providerChain: ["Yahoo"],
      providersObserved: [],
      providerStatus: "broken",
      stageCounts: {
        symbolsAttempted: 50,
        marketSnapshotCount: 0,
        tradeCandidateCount: 0,
        riskEvaluatedCandidateCount: 0,
        executableSignalCount: 0,
        publishedCount: 0,
        blockedCount: 0,
      },
      nullPriceCount: 50,
      staleCount: 0,
      averageFreshnessMs: null,
      worstFreshnessMs: null,
      publicationDistribution: { publishable: 0, watchlist_only: 0, shadow_only: 0, blocked: 0 },
      rejectionReasons: { NULL_PRICE: 50 },
      notes: ["provider returned no trustworthy prices"],
    },
    calibration,
    performance,
    providerReliability: [],
  });

  assert.equal(broken.promotionState, "runtime_broken");
});
