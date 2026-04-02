import assert from "node:assert/strict";
import test from "node:test";

import { defaultMarketScopeConfig } from "@/src/config/marketScope";
import type { DecisionJournalEntry, SignalLifecycleRecord } from "@/src/interfaces/contracts";
import { ApexRepository } from "@/src/lib/repository";

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

async function appendStoppedOutSignal(repository: ApexRepository, pair: string, ts: number, idSuffix: string) {
  await repository.appendDecisionJournal(makeEntry({
    decision_id: `decision_${idSuffix}`,
    signal_id: `signal_${idSuffix}`,
    ts,
    symbol_canonical: pair,
    pair,
    session: "london",
    regime: "trend",
    entry_style: "trend_pullback",
    direction: "buy",
    confidence: 0.7,
    final_action: "executed",
  }));
  await repository.appendSignalLifecycle(makeLifecycle({
    signal_id: `signal_${idSuffix}`,
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

async function appendTp1Signal(repository: ApexRepository, pair: string, ts: number, idSuffix: string) {
  await repository.appendDecisionJournal(makeEntry({
    decision_id: `decision_${idSuffix}`,
    signal_id: `signal_${idSuffix}`,
    ts,
    symbol_canonical: pair,
    pair,
    session: "london",
    regime: "trend",
    entry_style: "trend_pullback",
    direction: "buy",
    confidence: 0.82,
    final_action: "executed",
  }));
  await repository.appendSignalLifecycle(makeLifecycle({
    signal_id: `signal_${idSuffix}`,
    symbol_canonical: pair,
    direction: "buy",
    timeframe: "15m",
    entry_style: "trend_pullback",
    created_ts: ts,
    updated_ts: ts + 420_000,
    expires_at: ts + 3_600_000,
    state: "tp1_hit",
    outcome: "tp1_hit",
    entry: 1.1,
    sl: 1.096,
    tp1: 1.106,
    time_to_tp1_ms: 420_000,
    max_favorable_excursion: 0.004,
    max_adverse_excursion: 0.001,
    events: [
      { ts, state: "signal_created", detail: "created" },
      { ts: ts + 60_000, state: "activated", detail: "activated" },
      { ts: ts + 420_000, state: "tp1_hit", detail: "tp1" },
    ],
  }));
}

test("walk-forward validation reports forward effectiveness for approved recommendations", async () => {
  const repository = new ApexRepository();
  const activeSymbols = ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"];
  const now = Date.now();
  const preBase = now - (3 * 60 * 60 * 1000);

  await appendStoppedOutSignal(repository, "EURUSD", preBase, "eurusd_pre_1");
  await appendStoppedOutSignal(repository, "EURUSD", preBase + 900_000, "eurusd_pre_2");

  const quality = repository.getSignalQualityReport({
    symbols: activeSymbols,
    primaryEntryStyle: "trend_pullback",
    enabledEntryStyles: ["trend_pullback", "session_breakout", "range_reversal"],
    pairProfiles: defaultMarketScopeConfig.pairProfiles,
  });
  const snapshot = repository.createRecommendationSnapshot({
    qualityReport: quality,
    currentPairProfiles: defaultMarketScopeConfig.pairProfiles,
  });
  const review = repository.reviewRecommendationProposal({
    snapshotId: snapshot.snapshot_id,
    pair: "EURUSD",
    action: "approve",
    currentPairProfiles: defaultMarketScopeConfig.pairProfiles,
    qualityReport: quality,
  });

  assert.ok(review?.appliedHistory);

  const appliedAt = review?.appliedHistory?.applied_at ?? now;
  await appendTp1Signal(repository, "EURUSD", appliedAt + 60_000, "eurusd_post_1");
  await appendTp1Signal(repository, "EURUSD", appliedAt + 180_000, "eurusd_post_2");

  const run = repository.createWalkForwardValidationRun({
    activeSymbols,
    primaryEntryStyle: "trend_pullback",
    enabledEntryStyles: ["trend_pullback", "session_breakout", "range_reversal"],
    observationWindowMs: 6 * 60 * 60 * 1000,
    forwardWindowMs: 6 * 60 * 60 * 1000,
    rollingWindowMs: 2 * 60 * 60 * 1000,
    rollingStepMs: 60 * 60 * 1000,
  });

  assert.equal(run.active_symbols.length, 8);
  assert.ok(run.walk_forward_windows.some(window => window.pair === "EURUSD"));

  const eurusdEffect = run.recommendation_effectiveness.find(result => result.pair === "EURUSD");
  assert.ok(eurusdEffect);
  assert.equal(eurusdEffect?.verdict, "beneficial");
  assert.ok((eurusdEffect?.pre_change_vs_post_change.delta_summary.tp1_hit_rate_delta ?? 0) > 0);
  assert.ok((eurusdEffect?.pre_change_vs_post_change.delta_summary.stop_out_rate_delta ?? 0) < 0);
  assert.ok(eurusdEffect?.in_sample_vs_out_of_sample.confidence_calibration_change.length);

  const eurusdStability = run.pair_stability.find(row => row.pair === "EURUSD");
  assert.ok(eurusdStability);
  assert.ok((eurusdStability?.windows_observed ?? 0) > 0);
});
