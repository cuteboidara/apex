import assert from "node:assert/strict";
import test from "node:test";

import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import { getSignalHealthBadges, getSignalTrustRank } from "@/src/presentation/dashboard/components/signalPresentation";

function makeSignal(overrides: Partial<SignalViewModel>): SignalViewModel {
  return {
    id: "view_1",
    view_id: "view_1",
    entity_ref: "signal_1",
    signal_id: "signal_1",
    symbol: "EURUSD",
    cycleId: "cycle_1",
    generatedAt: Date.now(),
    displayCategory: "monitored",
    display_type: "monitored",
    livePrice: 1.08,
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    tp3: null,
    direction: "buy",
    grade: "B",
    gradeScore: 72,
    setupType: "trend pullback",
    session: "London",
    bias: "bullish",
    structure: "continuation",
    liquidityState: "no sweep",
    location: "discount",
    zoneType: "demand",
    marketPhase: "trend",
    confidence: 0.7,
    shortReasoning: "Test reasoning",
    detailedReasoning: "Detailed reasoning",
    whyThisSetup: "Setup",
    whyNow: "Now",
    whyThisLevel: "Level",
    invalidation: "Invalidation",
    whyThisGrade: "Grade",
    noTradeExplanation: null,
    marketStateLabels: [],
    noTradeReason: null,
    blockedReasons: [],
    riskStatus: "deferred",
    riskRuleCodes: [],
    riskExplainability: [],
    podVotes: [],
    lifecycleState: null,
    status: "watchlist",
    keyLevels: { pdh: null, pdl: null, sessionHigh: null, sessionLow: null },
    marketStructureSummary: "",
    liquiditySummary: "",
    keyLevelsSummary: "",
    headline: "Headline",
    summary: "Summary",
    reason_labels: [],
    confidence_label: null,
    ui_sections: {},
    commentary: null,
    ui_version: "signal_view_model_v4",
    generated_at: Date.now(),
    ...overrides,
  };
}

test("trust rank prioritizes publishable healthy signals above degraded or blocked ones", () => {
  const publishable = makeSignal({
    publicationStatus: "publishable",
    providerStatus: "healthy",
    dataTrustScore: 92,
    qualityScores: { structure: 80, market: 80, execution: 80, data: 92, assetFit: 84, composite: 83 },
  });
  const shadow = makeSignal({
    publicationStatus: "shadow_only",
    providerStatus: "fallback",
    dataTrustScore: 54,
    qualityScores: { structure: 80, market: 80, execution: 80, data: 54, assetFit: 84, composite: 75 },
  });
  const blocked = makeSignal({
    publicationStatus: "blocked",
    providerStatus: "broken",
    dataTrustScore: 8,
    qualityScores: { structure: 10, market: 10, execution: 10, data: 8, assetFit: 50, composite: 12 },
  });

  assert.ok(getSignalTrustRank(publishable) > getSignalTrustRank(shadow));
  assert.ok(getSignalTrustRank(shadow) > getSignalTrustRank(blocked));
});

test("health badges preserve degraded and blocked trust markers for the unified feed", () => {
  const signal = makeSignal({
    publicationStatus: "shadow_only",
    providerStatus: "fallback",
    dataTrustScore: 44,
    healthFlags: ["LOW TRUST"],
    ui_sections: { badges: ["CRYPTO"] },
  });

  const badges = getSignalHealthBadges(signal);

  assert.ok(badges.includes("SHADOW ONLY"));
  assert.ok(badges.includes("FALLBACK DATA"));
  assert.ok(badges.includes("LOW TRUST"));
});
