import assert from "node:assert/strict";
import test from "node:test";

import { buildFxSnapshotDataTrust, buildPublicationState, buildQualityScores, summarizeStageDiagnostics } from "@/src/domain/services/signalTrust";

test("fallback provider lowers trust and stale/broken data blocks publication", () => {
  const fallbackTrust = buildFxSnapshotDataTrust({
    marketData: {
      symbol: "EURUSD",
      interval: "15min",
      provider: "polygon",
      candlesFetched: 64,
      lastCandleTimestamp: 1_710_000_000_000,
      latencyMs: 120,
      sourceMode: "cache",
      usedFallback: true,
      qualityFlag: "clean",
      unavailableReason: null,
    },
    snapshotTimestamp: 1_710_000_300_000,
    snapshotQualityConfidence: 0.9,
  });

  assert.equal(fallbackTrust.providerStatus, "fallback");
  assert.ok(fallbackTrust.dataTrustScore < 60);

  const qualityScores = buildQualityScores({
    structure: 72,
    market: 68,
    execution: 70,
    data: fallbackTrust.dataTrustScore,
    assetFit: 84,
  });

  const blocked = buildPublicationState({
    providerStatus: fallbackTrust.providerStatus,
    livePrice: null,
    quoteIntegrity: false,
    dataTrustScore: fallbackTrust.dataTrustScore,
    qualityScores,
  });

  assert.equal(blocked.status, "blocked");
  assert.ok(blocked.reasons.includes("NULL_PRICE"));
  assert.ok(blocked.reasons.includes("QUOTE_INTEGRITY_FAILED"));
});

test("stage diagnostics persist counts and rejection reason distribution", () => {
  const diagnostics = summarizeStageDiagnostics({
    cycleId: "cycle_1",
    startedAt: 1_710_000_000_000,
    completedAt: 1_710_000_060_000,
    symbolsProcessed: ["EURUSD", "GBPUSD"],
    snapshots: [
      { asset_class: "fx", provider_status: "healthy", data_trust_score: 90, quote_integrity: true },
      { asset_class: "fx", provider_status: "fallback", data_trust_score: 54, quote_integrity: true },
    ],
    candidates: [
      { publication_status: "watchlist_only", publication_reasons: ["FALLBACK_PROVIDER"] },
    ],
    riskResults: [
      { decision: "approved", publication_status: "shadow_only", publication_reasons: ["FALLBACK_PROVIDER"] },
    ],
    signals: [
      { publication_status: "publishable" },
    ],
    viewModels: [
      { assetClass: "fx", providerStatus: "healthy", publicationStatus: "publishable", publicationReasons: [], dataTrustScore: 90 },
      { assetClass: "fx", providerStatus: "fallback", publicationStatus: "shadow_only", publicationReasons: ["FALLBACK_PROVIDER"], dataTrustScore: 54 },
    ],
  });

  const stageCounts = diagnostics.stageCounts as Record<string, number>;
  const rejectionBreakdown = diagnostics.rejectionReasonBreakdown as Record<string, number>;

  assert.equal(stageCounts.marketSnapshotCount, 2);
  assert.equal(stageCounts.tradeCandidateCount, 1);
  assert.equal(stageCounts.publishedCount, 1);
  assert.equal(rejectionBreakdown.FALLBACK_PROVIDER, 3);
});
