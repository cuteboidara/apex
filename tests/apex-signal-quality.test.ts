import assert from "node:assert/strict";
import test from "node:test";

import type { DecisionJournalEntry, SignalLifecycleRecord } from "@/src/interfaces/contracts";
import { ApexRepository } from "@/src/lib/repository";

function approx(actual: number | null, expected: number, epsilon = 1e-9) {
  assert.notEqual(actual, null);
  assert.ok(Math.abs((actual ?? 0) - expected) <= epsilon, `expected ${expected}, received ${actual}`);
}

function weekday(ts: number) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(new Date(ts));
}

function makeEntry(overrides: Partial<DecisionJournalEntry> & Pick<DecisionJournalEntry, "decision_id" | "signal_id" | "ts" | "symbol_canonical" | "pair" | "session" | "regime" | "entry_style" | "direction" | "confidence" | "final_action">): DecisionJournalEntry {
  return {
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    tp3: null,
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

test("repository builds signal-quality analytics from journal plus latest lifecycle state", async () => {
  const repository = new ApexRepository();
  const activeSymbols = ["EURUSD", "GBPUSD", "USDJPY", "EURJPY", "AUDUSD", "NZDUSD", "USDCHF", "USDCAD"];
  const monday = Date.parse("2026-03-23T08:00:00.000Z");
  const tuesday = Date.parse("2026-03-24T09:00:00.000Z");
  const wednesday = Date.parse("2026-03-25T10:00:00.000Z");

  await repository.appendDecisionJournal(makeEntry({
    decision_id: "journal_eurusd_tp3",
    signal_id: "signal_eurusd_tp3",
    ts: monday,
    symbol_canonical: "EURUSD",
    pair: "EURUSD",
    session: "london",
    regime: "trend",
    entry_style: "trend_pullback",
    direction: "buy",
    confidence: 0.83,
    final_action: "executed",
  }));
  await repository.appendSignalLifecycle(makeLifecycle({
    signal_id: "signal_eurusd_tp3",
    symbol_canonical: "EURUSD",
    direction: "buy",
    timeframe: "15m",
    entry_style: "trend_pullback",
    created_ts: monday,
    updated_ts: monday + 900_000,
    expires_at: monday + 3_600_000,
    state: "tp3_hit",
    outcome: "tp3_hit",
    entry: 1.1,
    sl: 1.095,
    tp1: 1.105,
    tp2: 1.108,
    tp3: 1.111,
    max_favorable_excursion: 0.006,
    max_adverse_excursion: 0.001,
    time_to_tp1_ms: 300_000,
    events: [
      { ts: monday, state: "signal_created", detail: "created" },
      { ts: monday + 60_000, state: "activated", detail: "activated" },
      { ts: monday + 300_000, state: "tp1_hit", detail: "tp1" },
      { ts: monday + 600_000, state: "tp2_hit", detail: "tp2" },
      { ts: monday + 900_000, state: "tp3_hit", detail: "tp3" },
    ],
  }));

  await repository.appendDecisionJournal(makeEntry({
    decision_id: "journal_gbpusd_rejected",
    signal_id: "signal_gbpusd_rejected",
    ts: monday + 1_800_000,
    symbol_canonical: "GBPUSD",
    pair: "GBPUSD",
    session: "off_hours",
    regime: "trend",
    entry_style: "trend_pullback",
    direction: "buy",
    confidence: 0.52,
    veto_reasons: ["OFF_SESSION", "NEWS_WINDOW"],
    final_action: "rejected",
  }));

  await repository.appendDecisionJournal(makeEntry({
    decision_id: "journal_usdjpy_expired",
    signal_id: "signal_usdjpy_expired",
    ts: tuesday,
    symbol_canonical: "USDJPY",
    pair: "USDJPY",
    session: "asia",
    regime: "range",
    entry_style: "trend_pullback",
    direction: "sell",
    confidence: 0.67,
    final_action: "executed",
  }));
  await repository.appendSignalLifecycle(makeLifecycle({
    signal_id: "signal_usdjpy_expired",
    symbol_canonical: "USDJPY",
    direction: "sell",
    timeframe: "15m",
    entry_style: "trend_pullback",
    created_ts: tuesday,
    updated_ts: tuesday + 1_800_000,
    expires_at: tuesday + 1_800_000,
    state: "expired",
    outcome: "expired",
    entry: 149.2,
    sl: 149.6,
    tp1: 148.8,
    events: [
      { ts: tuesday, state: "signal_created", detail: "created" },
      { ts: tuesday + 300_000, state: "pending_trigger", detail: "pending" },
      { ts: tuesday + 1_800_000, state: "expired", detail: "expired" },
    ],
  }));

  await repository.appendDecisionJournal(makeEntry({
    decision_id: "journal_eurjpy_stop",
    signal_id: "signal_eurjpy_stop",
    ts: tuesday + 3_600_000,
    symbol_canonical: "EURJPY",
    pair: "EURJPY",
    session: "london",
    regime: "trend",
    entry_style: "trend_pullback",
    direction: "buy",
    confidence: 0.76,
    final_action: "executed",
  }));
  await repository.appendSignalLifecycle(makeLifecycle({
    signal_id: "signal_eurjpy_stop",
    symbol_canonical: "EURJPY",
    direction: "buy",
    timeframe: "15m",
    entry_style: "trend_pullback",
    created_ts: tuesday + 3_600_000,
    updated_ts: tuesday + 4_500_000,
    expires_at: tuesday + 7_200_000,
    state: "stopped_out",
    outcome: "stopped_out",
    entry: 161.2,
    sl: 160.8,
    tp1: 161.6,
    max_favorable_excursion: 0.0032,
    max_adverse_excursion: 0.0024,
    time_to_tp1_ms: 600_000,
    time_to_sl_ms: 900_000,
    events: [
      { ts: tuesday + 3_600_000, state: "signal_created", detail: "created" },
      { ts: tuesday + 3_720_000, state: "activated", detail: "activated" },
      { ts: tuesday + 4_200_000, state: "tp1_hit", detail: "tp1" },
      { ts: tuesday + 4_500_000, state: "stopped_out", detail: "stop" },
    ],
  }));

  await repository.appendDecisionJournal(makeEntry({
    decision_id: "journal_eurusd_cancel",
    signal_id: "signal_eurusd_cancel",
    ts: wednesday,
    symbol_canonical: "EURUSD",
    pair: "EURUSD",
    session: "new_york",
    regime: "trend",
    entry_style: "trend_pullback",
    direction: "buy",
    confidence: 0.91,
    veto_reasons: ["SESSION_LOCK"],
    final_action: "deferred",
  }));
  await repository.appendSignalLifecycle(makeLifecycle({
    signal_id: "signal_eurusd_cancel",
    symbol_canonical: "EURUSD",
    direction: "buy",
    timeframe: "15m",
    entry_style: "trend_pullback",
    created_ts: wednesday,
    updated_ts: wednesday + 60_000,
    expires_at: wednesday + 3_600_000,
    state: "cancelled",
    outcome: "cancelled",
    entry: 1.102,
    sl: 1.097,
    tp1: 1.107,
    events: [
      { ts: wednesday, state: "signal_created", detail: "created" },
      { ts: wednesday + 60_000, state: "cancelled", detail: "cancelled" },
    ],
  }));

  await repository.appendDecisionJournal(makeEntry({
    decision_id: "journal_audcad_ignored",
    signal_id: "signal_audcad_ignored",
    ts: wednesday + 600_000,
    symbol_canonical: "AUDCAD",
    pair: "AUDCAD",
    session: "london",
    regime: "trend",
    entry_style: "trend_pullback",
    direction: "buy",
    confidence: 0.88,
    final_action: "executed",
  }));
  await repository.appendSignalLifecycle(makeLifecycle({
    signal_id: "signal_audcad_ignored",
    symbol_canonical: "AUDCAD",
    direction: "buy",
    timeframe: "15m",
    entry_style: "trend_pullback",
    created_ts: wednesday + 600_000,
    updated_ts: wednesday + 900_000,
    expires_at: wednesday + 3_600_000,
    state: "tp1_hit",
    outcome: "tp1_hit",
    entry: 3050,
    sl: 3040,
    tp1: 3060,
    max_favorable_excursion: 10,
    max_adverse_excursion: 2,
    time_to_tp1_ms: 180_000,
    events: [
      { ts: wednesday + 600_000, state: "signal_created", detail: "created" },
      { ts: wednesday + 660_000, state: "activated", detail: "activated" },
      { ts: wednesday + 900_000, state: "tp1_hit", detail: "tp1" },
    ],
  }));

  const report = repository.getSignalQualityReport({
    symbols: activeSymbols,
    primaryEntryStyle: "trend_pullback",
    enabledEntryStyles: ["trend_pullback", "session_breakout", "range_reversal"],
  });

  assert.deepEqual(report.active_symbols, activeSymbols);
  assert.equal(report.primary_entry_style, "trend_pullback");
  assert.deepEqual(report.enabled_entry_styles, ["trend_pullback", "session_breakout", "range_reversal"]);

  assert.equal(report.totals.signals_issued, 5);
  assert.equal(report.totals.signals_activated, 2);
  assert.equal(report.totals.veto_count, 2);
  assert.equal(report.totals.tp1_hit_count, 2);
  assert.equal(report.totals.tp2_hit_count, 1);
  assert.equal(report.totals.tp3_hit_count, 1);
  assert.equal(report.totals.stop_out_count, 1);
  assert.equal(report.totals.expiry_count, 1);
  assert.equal(report.totals.cancellation_count, 1);
  approx(report.totals.tp1_hit_rate, 1);
  approx(report.totals.tp2_hit_rate, 0.5);
  approx(report.totals.tp3_hit_rate, 0.5);
  approx(report.totals.stop_out_rate, 0.5);
  approx(report.totals.expiry_rate, 0.2);
  approx(report.totals.cancellation_rate, 0.2);
  approx(report.totals.average_mfe, 0.0046);
  approx(report.totals.average_mae, 0.0017);
  approx(report.totals.average_time_to_activation_ms, 90_000);
  approx(report.totals.average_time_to_tp1_ms, 450_000);
  approx(report.totals.average_time_to_stop_ms, 900_000);

  const eurusd = report.by_pair.find(row => row.pair === "EURUSD");
  assert.ok(eurusd);
  assert.equal(eurusd?.signals_issued, 2);
  assert.equal(eurusd?.signals_activated, 1);
  assert.equal(eurusd?.veto_count, 1);
  approx(eurusd?.tp3_hit_rate ?? null, 1);
  approx(eurusd?.cancellation_rate ?? null, 0.5);

  const usdjpy = report.by_pair.find(row => row.pair === "USDJPY");
  assert.ok(usdjpy);
  approx(usdjpy?.expiry_rate ?? null, 1);

  const weekdayRow = report.by_weekday.find(row => row.weekday === weekday(monday));
  assert.ok(weekdayRow);
  assert.equal(weekdayRow?.signals_issued, 2);

  const confidenceRow = report.confidence_calibration.find(row => row.confidence_bucket === "90-100%");
  assert.ok(confidenceRow);
  assert.equal(confidenceRow?.signals_issued, 1);
  assert.equal(confidenceRow?.signals_vetoed, 1);

  const eurjpySlice = report.by_slice.find(row =>
    row.pair === "EURJPY"
    && row.session === "london"
    && row.regime === "trend"
    && row.confidence_bucket === "70-79%",
  );
  assert.ok(eurjpySlice);
  approx(eurjpySlice?.tp1_hit_rate ?? null, 1);
  approx(eurjpySlice?.stop_out_rate ?? null, 1);

  const offSession = report.veto_effectiveness.find(row => row.reason === "OFF_SESSION");
  assert.ok(offSession);
  assert.equal(offSession?.count, 1);
  assert.equal(offSession?.associated_slices[0]?.pair, "GBPUSD");
  assert.equal(offSession?.associated_slices[0]?.session, "off_hours");
  assert.equal(offSession?.confidence_distribution[0]?.confidence_bucket, "50-59%");

  const timingRow = report.signal_timing_diagnostics.find(row => row.pair === "EURJPY" && row.session === "london");
  assert.ok(timingRow);
  approx(timingRow?.activation_rate ?? null, 1);
  approx(timingRow?.average_time_to_activation_ms ?? null, 120_000);
  approx(timingRow?.average_time_from_activated_to_tp1_ms ?? null, 480_000);
  approx(timingRow?.average_time_from_activated_to_stop_ms ?? null, 780_000);

  const eurusdTuning = report.pair_tuning_recommendations.find(row => row.pair === "EURUSD");
  assert.ok(eurusdTuning);
  assert.equal(eurusdTuning?.sample_size, 2);
  approx(eurusdTuning?.suggested_minimum_confidence_threshold ?? null, 0.8);
  approx(eurusdTuning?.suggested_minimum_rr_threshold ?? null, 1.7);
  assert.deepEqual(eurusdTuning?.preferred_sessions, ["london"]);
  assert.equal(eurusdTuning?.cooldown_recommendation_minutes, 30);
  assert.ok((eurusdTuning?.notes.length ?? 0) > 0);

  assert.equal(report.by_pair.some(row => row.pair === "USDCAD"), false);
});
