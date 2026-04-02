"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { DataPanel } from "@/src/dashboard/components/DataPanel";
import { StatusBadge } from "@/src/dashboard/components/StatusBadge";
import type { DecisionJournalEntry } from "@/src/interfaces/contracts";

type JournalFilters = {
  symbol: string;
  action: "" | DecisionJournalEntry["final_action"];
  from: string;
  to: string;
};

function toTimestampRange(filters: JournalFilters) {
  const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : null;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : null;
  return { from, to };
}

function buildJournalQuery(filters: JournalFilters) {
  const params = new URLSearchParams();
  const { from, to } = toTimestampRange(filters);

  if (filters.symbol.trim()) {
    params.set("symbol", filters.symbol.trim().toUpperCase());
  }
  if (filters.action) {
    params.set("action", filters.action);
  }
  if (from != null && Number.isFinite(from)) {
    params.set("from", String(from));
  }
  if (to != null && Number.isFinite(to)) {
    params.set("to", String(to));
  }

  const query = params.toString();
  return query ? `/api/journal?${query}` : "/api/journal";
}

function toneForAction(action: DecisionJournalEntry["final_action"]) {
  if (action === "executed") return "good" as const;
  if (action === "deferred") return "warn" as const;
  return "bad" as const;
}

export function JournalFeedClient({
  initialEntries,
}: {
  initialEntries: DecisionJournalEntry[];
}) {
  const [rows, setRows] = useState(initialEntries);
  const [filters, setFilters] = useState<JournalFilters>({
    symbol: "",
    action: "",
    from: "",
    to: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setRows(initialEntries);
  }, [initialEntries]);

  const runQuery = useCallback(async (nextFilters: JournalFilters) => {
    const response = await fetch(buildJournalQuery(nextFilters), {
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Unable to load decision journal.");
    }

    const payload = await response.json() as DecisionJournalEntry[];
    setRows(payload);
    setError(null);
  }, []);

  function submitFilters() {
    startTransition(async () => {
      try {
        await runQuery(filters);
      } catch (queryError) {
        setError(queryError instanceof Error ? queryError.message : "Unable to load decision journal.");
      }
    });
  }

  function resetFilters() {
    const cleared: JournalFilters = {
      symbol: "",
      action: "",
      from: "",
      to: "",
    };
    setFilters(cleared);
    startTransition(async () => {
      try {
        await runQuery(cleared);
      } catch (queryError) {
        setError(queryError instanceof Error ? queryError.message : "Unable to load decision journal.");
      }
    });
  }

  return (
    <div className="space-y-4">
      <DataPanel title="Journal Filters" eyebrow="Queryable Trace">
        <form
          className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr_0.9fr_0.9fr_auto_auto]"
          onSubmit={event => {
            event.preventDefault();
            submitFilters();
          }}
        >
          <label className="space-y-2">
            <span className="apex-form-label mb-0">Symbol</span>
            <input
              value={filters.symbol}
              onChange={event => setFilters(current => ({ ...current, symbol: event.target.value }))}
              placeholder="EURUSD"
              className="apex-form-input min-h-[40px] font-[var(--apex-font-mono)] text-sm"
            />
          </label>
          <label className="space-y-2">
            <span className="apex-form-label mb-0">Action</span>
            <select
              value={filters.action}
              onChange={event => setFilters(current => ({ ...current, action: event.target.value as JournalFilters["action"] }))}
              className="apex-form-select min-h-[40px] font-[var(--apex-font-mono)] text-sm"
            >
              <option value="">All actions</option>
              <option value="executed">Executed</option>
              <option value="rejected">Rejected</option>
              <option value="deferred">Deferred</option>
              <option value="halted">Halted</option>
            </select>
          </label>
          <label className="space-y-2">
            <span className="apex-form-label mb-0">From</span>
            <input
              type="date"
              value={filters.from}
              onChange={event => setFilters(current => ({ ...current, from: event.target.value }))}
              className="apex-form-input min-h-[40px] font-[var(--apex-font-mono)] text-sm"
            />
          </label>
          <label className="space-y-2">
            <span className="apex-form-label mb-0">To</span>
            <input
              type="date"
              value={filters.to}
              onChange={event => setFilters(current => ({ ...current, to: event.target.value }))}
              className="apex-form-input min-h-[40px] font-[var(--apex-font-mono)] text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="apex-button apex-button-amber disabled:opacity-60"
          >
            {pending ? "Loading" : "Apply"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={resetFilters}
            className="apex-button apex-button-muted disabled:opacity-60"
          >
            Reset
          </button>
        </form>
        {error ? <p className="mt-3 text-xs text-[var(--apex-status-blocked-text)]">{error}</p> : null}
      </DataPanel>

      <DataPanel title="Decision Trace" eyebrow={`${rows.length} rows`}>
        <div className="space-y-3">
          {rows.map(entry => (
            <details key={entry.decision_id} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{entry.symbol_canonical}</p>
                    <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-tertiary)]">{new Date(entry.ts).toLocaleString()}</p>
                    <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-tertiary)]">
                      {entry.direction} • {entry.session} • {entry.regime}
                    </p>
                  </div>
                  <p className="mt-2 max-w-4xl text-sm leading-6 text-[var(--apex-text-secondary)]">{entry.human_summary}</p>
                </div>
                <StatusBadge label={entry.final_action} tone={toneForAction(entry.final_action)} />
              </summary>
              <div className="mt-4 grid gap-3 border-t border-[var(--apex-border-subtle)] pt-4 md:grid-cols-2 xl:grid-cols-5">
                {[
                  ["Snapshot", entry.market_snapshot_ref],
                  ["Pods", entry.pod_output_refs.join(", ") || "n/a"],
                  ["Allocation", entry.allocation_ref],
                  ["Risk", entry.risk_decision_ref],
                  ["Execution", entry.execution_intent_ref],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3">
                    <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">{label}</p>
                    <p className="mt-2 break-all font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)]">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3">
                  <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Levels</p>
                  <p className="mt-2 font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)]">
                    E {entry.entry ?? "n/a"} | SL {entry.sl ?? "n/a"} | TP1 {entry.tp1 ?? "n/a"}
                  </p>
                  <p className="mt-1 font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-tertiary)]">
                    TP2 {entry.tp2 ?? "n/a"} | TP3 {entry.tp3 ?? "n/a"}
                  </p>
                </div>
                <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3">
                  <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Veto Reasons</p>
                  <p className="mt-2 text-xs text-[var(--apex-text-secondary)]">{entry.veto_reasons.join(", ") || "none"}</p>
                </div>
                <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3">
                  <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Lifecycle</p>
                  <p className="mt-2 text-xs text-[var(--apex-text-secondary)]">
                    {entry.lifecycle_state ?? "n/a"} • {entry.outcome ?? "n/a"}
                  </p>
                </div>
                <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3">
                  <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Excursions</p>
                  <p className="mt-2 text-xs text-[var(--apex-text-secondary)]">
                    MFE {entry.maxFavorableExcursion?.toFixed(4) ?? "n/a"} | MAE {entry.maxAdverseExcursion?.toFixed(4) ?? "n/a"}
                  </p>
                </div>
              </div>
              <div className="mt-4 rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3">
                <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Reasoning</p>
                <div className="mt-3 space-y-2 text-sm text-[var(--apex-text-secondary)]">
                  {entry.reasoning.map(reason => (
                    <p key={reason}>{reason}</p>
                  ))}
                </div>
              </div>
            </details>
          ))}
          {rows.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No journal entries match the current filters.</p> : null}
        </div>
      </DataPanel>
    </div>
  );
}
