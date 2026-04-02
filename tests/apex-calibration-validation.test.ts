import assert from "node:assert/strict";
import test from "node:test";

import { buildCalibrationSummaryForAsset, type TradePlanOutcomeRow } from "@/src/application/analytics/alphaReport";
import { estimateCrossAssetCalibratedConfidence, getCrossAssetCalibrationProfile } from "@/src/application/calibration/crossAssetWeights";

function makeRow(index: number, overrides: Partial<TradePlanOutcomeRow> = {}): TradePlanOutcomeRow {
  const now = new Date(`2026-03-29T12:${String(index).padStart(2, "0")}:00.000Z`);
  return {
    signalId: `sig_${index}`,
    symbol: "EURUSD",
    assetClass: "fx",
    style: "INTRADAY",
    setupFamily: "trend_pullback",
    bias: "LONG",
    confidence: 85,
    publicationRank: "A",
    publicationStatus: "publishable",
    providerAtSignal: "Yahoo Finance",
    providerHealthStateAtSignal: "HEALTHY",
    providerFallbackUsedAtSignal: false,
    dataQuality: "healthy",
    regimeTag: "trend",
    qualityGateReason: null,
    outcome: "STOP",
    detectedAt: now,
    entryHitAt: now,
    stopHitAt: new Date(now.getTime() + 30 * 60_000),
    tp1HitAt: null,
    tp2HitAt: null,
    tp3HitAt: null,
    invalidatedAt: null,
    expiredAt: null,
    realizedRR: -1,
    maxFavorableExcursion: 0.2,
    maxAdverseExcursion: 1.1,
    createdAt: now,
    updatedAt: new Date(now.getTime() + 30 * 60_000),
    ...overrides,
  };
}

test("calibration flags misaligned high-confidence buckets", () => {
  const rows: TradePlanOutcomeRow[] = [
    ...Array.from({ length: 9 }, (_, index) => makeRow(index, {
      outcome: "STOP",
      realizedRR: -1,
      stopHitAt: new Date("2026-03-29T13:00:00.000Z"),
    })),
    ...Array.from({ length: 3 }, (_, index) => makeRow(index + 20, {
      outcome: "TP1",
      realizedRR: 0.9,
      tp1HitAt: new Date("2026-03-29T13:10:00.000Z"),
      stopHitAt: null,
    })),
  ];

  const summary = buildCalibrationSummaryForAsset("fx", rows);

  assert.equal(summary.calibrationSampleSize, 12);
  assert.equal(summary.miscalibratedComponent, "execution");
  assert.ok(summary.calibrationWarning);
  assert.equal(summary.curve[0]?.confidenceMin, 80);
  assert.ok((summary.curve[0]?.actualWinRate ?? 1) < (summary.curve[0]?.expectedWinRate ?? 0));
});

test("cross-asset calibration profiles port FX weights as experimental adjustments", () => {
  const fxProfile = getCrossAssetCalibrationProfile("fx", 111);
  const cryptoProfile = getCrossAssetCalibrationProfile("crypto", 8);
  const cryptoConfidence = estimateCrossAssetCalibratedConfidence({
    assetClass: "crypto",
    rawConfidence: 0.64,
    qualityScores: {
      structure: 68,
      market: 55,
      execution: 72,
      data: 49,
      assetFit: 66,
    },
    sampleSize: 8,
  });

  assert.equal(fxProfile.experimental, false);
  assert.equal(cryptoProfile.experimental, true);
  assert.notDeepEqual(cryptoProfile.weights, fxProfile.weights);
  assert.ok(cryptoProfile.weights.execution > fxProfile.weights.execution);
  assert.ok(cryptoConfidence.calibratedConfidence >= 0 && cryptoConfidence.calibratedConfidence <= 1);
});
