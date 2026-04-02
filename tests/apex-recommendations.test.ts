import assert from "node:assert/strict";
import test from "node:test";

import { defaultMarketScopeConfig } from "@/src/config/marketScope";
import {
  generateRecommendationSnapshotPayload,
  reviewRecommendationProposalPayload,
} from "@/src/api/recommendations";
import { resetApexConfigForTests } from "@/src/lib/config";
import { ApexRepository } from "@/src/lib/repository";
import { getApexRuntime, resetApexRuntimeForTests } from "@/src/lib/runtime";
import type { DecisionJournalEntry, SignalLifecycleRecord } from "@/src/interfaces/contracts";

function makeEntry(overrides: Partial<DecisionJournalEntry> & Pick<DecisionJournalEntry, "decision_id" | "signal_id" | "ts" | "symbol_canonical" | "pair" | "session" | "regime" | "entry_style" | "direction" | "confidence" | "final_action">): DecisionJournalEntry {
  return {
    entry: 1.1,
    sl: 1.095,
    tp1: 1.105,
    tp2: 1.108,
    tp3: 1.111,
    pod_votes: { directional: [], gating: [] },
    veto_reasons: [],
    market_snapshot_ref: "snapshot",
    pod_output_refs: [],
    allocation_ref: "allocation",
    risk_decision_ref: "risk",
    execution_intent_ref: "execution",
    reasoning: [],
    human_summary: "summary",
    ...overrides,
  };
}

function makeLifecycle(overrides: Partial<SignalLifecycleRecord> & Pick<SignalLifecycleRecord, "signal_id" | "symbol_canonical" | "direction" | "timeframe" | "entry_style" | "created_ts" | "updated_ts" | "expires_at" | "state" | "outcome" | "entry" | "sl" | "tp1">): SignalLifecycleRecord {
  return {
    tp2: null,
    tp3: null,
    max_favorable_excursion: 0,
    max_adverse_excursion: 0,
    events: [],
    ...overrides,
  };
}

async function seedSignal(repository: ApexRepository, pair: string, ts: number) {
  await repository.appendDecisionJournal(makeEntry({
    decision_id: `decision_${pair}_${ts}`,
    signal_id: `signal_${pair}_${ts}`,
    ts,
    symbol_canonical: pair,
    pair,
    session: "london",
    regime: "trend",
    entry_style: "trend_pullback",
    direction: "buy",
    confidence: 0.72,
    final_action: "executed",
  }));
  await repository.appendSignalLifecycle(makeLifecycle({
    signal_id: `signal_${pair}_${ts}`,
    symbol_canonical: pair,
    direction: "buy",
    timeframe: "15m",
    entry_style: "trend_pullback",
    created_ts: ts,
    updated_ts: ts + 600_000,
    expires_at: ts + 3_600_000,
    state: "stopped_out",
    outcome: "stopped_out",
    entry: 1.1,
    sl: 1.095,
    tp1: 1.105,
    time_to_sl_ms: 600_000,
    max_favorable_excursion: 0.001,
    max_adverse_excursion: 0.003,
    events: [
      { ts, state: "signal_created", detail: "created" },
      { ts: ts + 60_000, state: "activated", detail: "activated" },
      { ts: ts + 600_000, state: "stopped_out", detail: "stop" },
    ],
  }));
}

test("repository creates versioned recommendation snapshots and supersedes older proposals", async () => {
  const repository = new ApexRepository();
  const ts = Date.parse("2026-03-25T08:00:00.000Z");

  await seedSignal(repository, "EURUSD", ts);

  const quality = repository.getSignalQualityReport({
    symbols: ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"],
    primaryEntryStyle: "trend_pullback",
    enabledEntryStyles: ["trend_pullback", "session_breakout", "range_reversal"],
    pairProfiles: defaultMarketScopeConfig.pairProfiles,
  });

  const first = repository.createRecommendationSnapshot({
    qualityReport: quality,
    currentPairProfiles: defaultMarketScopeConfig.pairProfiles,
  });
  const second = repository.createRecommendationSnapshot({
    qualityReport: quality,
    currentPairProfiles: defaultMarketScopeConfig.pairProfiles,
  });

  assert.equal(first.version, 1);
  assert.equal(second.version, 2);

  const supersededFirst = repository.getRecommendationSnapshot(first.snapshot_id);
  assert.ok(supersededFirst);
  assert.ok(supersededFirst?.proposals.every(proposal => proposal.approval_status === "superseded"));
  assert.ok(second.proposals.every(proposal => proposal.approval_status === "proposed"));
});

test("recommendation approval flow updates the live runtime pair profile and records applied history", async () => {
  resetApexRuntimeForTests();
  resetApexConfigForTests();

  try {
    const runtime = getApexRuntime();
    const ts = Date.parse("2026-03-25T09:00:00.000Z");

    await seedSignal(runtime.repository, "EURUSD", ts);

    const generated = await generateRecommendationSnapshotPayload();
    const snapshot = generated.snapshot;
    const eurusdProposal = snapshot.proposals.find(proposal => proposal.pair === "EURUSD");

    assert.ok(eurusdProposal);
    assert.equal(eurusdProposal?.approval_status, "proposed");

    const review = await reviewRecommendationProposalPayload({
      snapshotId: snapshot.snapshot_id,
      pair: "EURUSD",
      action: "approve",
    });

    assert.ok(review);
    assert.equal(review?.proposal.approval_status, "approved");
    assert.equal(review?.applied_history[0]?.pair, "EURUSD");
    assert.deepEqual(
      runtime.config.marketScope.pairProfiles.EURUSD,
      {
        minConfidence: review?.proposal.proposed_profile.minConfidence,
        minRiskReward: review?.proposal.proposed_profile.minRiskReward,
        allowedSessions: review?.proposal.proposed_profile.allowedSessions,
        preferredSessions: review?.proposal.proposed_profile.preferredSessions,
        avoidSessions: review?.proposal.proposed_profile.avoidSessions,
        maxSignalsPerDay: review?.proposal.proposed_profile.maxSignalsPerDay,
        cooldownMinutes: review?.proposal.proposed_profile.cooldownMinutes,
        atrToleranceMultiplier: review?.proposal.proposed_profile.atrToleranceMultiplier,
      },
    );
  } finally {
    resetApexRuntimeForTests();
    resetApexConfigForTests();
  }
});
