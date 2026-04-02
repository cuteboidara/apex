"use client";

import { useEffect, useState, useTransition } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

type BacktestRun = {
  id: string;
  name: string;
  symbol: string | null;
  assetClass: string | null;
  timeframe: string;
  status: string;
  failureReason: string | null;
  startedAt: string;
  completedAt: string | null;
  summary: {
    sampleSize?: number;
    winRate?: number | null;
    expectancy?: number | null;
    maxDrawdown?: number | null;
  } | null;
};

type BacktestsResponse = {
  runs?: BacktestRun[];
};

const DEFAULT_FORM = {
  symbol: "EURUSD",
  assetClass: "FOREX",
  style: "INTRADAY",
  spreadBps: "1",
  slippageBps: "1",
  confidenceFloor: "65",
};

export default function AdminBacktestsPage() {
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const loadRuns = async (showLoading = true) => {
    if (showLoading) {
      setIsLoading(true);
    }
    const result = await fetchJsonResponse<BacktestsResponse>("/api/backtest");
    setRuns(result.data?.runs ?? []);
    setError(result.ok ? null : formatApiError(result, "Unable to load backtest runs."));
    setIsLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchJsonResponse<BacktestsResponse>("/api/backtest");
      if (cancelled) {
        return;
      }
      setRuns(result.data?.runs ?? []);
      setError(result.ok ? null : formatApiError(result, "Unable to load backtest runs."));
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runBacktest = () => {
    setError(null);
    startTransition(async () => {
      const result = await fetchJsonResponse<{ runId?: string }>("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: form.symbol,
          assetClass: form.assetClass,
          style: form.style,
          spreadBps: Number(form.spreadBps),
          slippageBps: Number(form.slippageBps),
          confidenceFloor: Number(form.confidenceFloor),
        }),
      });

      if (!result.ok) {
        setError(formatApiError(result, "Backtest failed."));
        return;
      }

      await loadRuns();
    });
  };

  return (
    <div className="space-y-8">
      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Deterministic Replay</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          Backtest and replay controls
        </h2>
        <p className="mt-3 max-w-[780px] text-[14px] leading-7 text-[var(--apex-text-secondary)]">
          Run deterministic replays against persisted candles to validate the runtime profile without disturbing live delivery.
        </p>
      </section>

      <section className="apex-surface px-6 py-6">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="text-sm">
            <span className="apex-form-label">Symbol</span>
            <input className="apex-form-input" value={form.symbol} onChange={event => setForm(current => ({ ...current, symbol: event.target.value.toUpperCase() }))} />
          </label>
          <label className="text-sm">
            <span className="apex-form-label">Asset Class</span>
            <select className="apex-form-select" value={form.assetClass} onChange={event => setForm(current => ({ ...current, assetClass: event.target.value }))}>
              <option value="FOREX">FOREX</option>
              <option value="COMMODITY">COMMODITY</option>
              <option value="CRYPTO">CRYPTO</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="apex-form-label">Style</span>
            <select className="apex-form-select" value={form.style} onChange={event => setForm(current => ({ ...current, style: event.target.value }))}>
              <option value="SCALP">SCALP</option>
              <option value="INTRADAY">INTRADAY</option>
              <option value="SWING">SWING</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="apex-form-label">Spread Bps</span>
            <input className="apex-form-input" value={form.spreadBps} onChange={event => setForm(current => ({ ...current, spreadBps: event.target.value }))} />
          </label>
          <label className="text-sm">
            <span className="apex-form-label">Slippage Bps</span>
            <input className="apex-form-input" value={form.slippageBps} onChange={event => setForm(current => ({ ...current, slippageBps: event.target.value }))} />
          </label>
          <label className="text-sm">
            <span className="apex-form-label">Confidence Floor</span>
            <input className="apex-form-input" value={form.confidenceFloor} onChange={event => setForm(current => ({ ...current, confidenceFloor: event.target.value }))} />
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button onClick={runBacktest} disabled={isPending} className="apex-button apex-button-amber disabled:opacity-60">
            {isPending ? "Running Replay" : "Run Replay"}
          </button>
          {error ? <p className="text-sm text-[var(--apex-status-blocked-text)]">{error}</p> : null}
          {!error && isLoading ? <p className="text-sm text-[var(--apex-text-tertiary)]">Loading backtest history…</p> : null}
        </div>
      </section>

      <section className="apex-table-shell px-6 py-5">
        <div className="mb-4">
          <p className="apex-eyebrow">Replay History</p>
          <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Stored backtest runs</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="apex-table min-w-[860px]">
            <thead>
              <tr>
                <th>Run</th>
                <th>Status</th>
                <th>Sample</th>
                <th>Win Rate</th>
                <th>Expectancy</th>
                <th>Drawdown</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(run => (
                <tr key={run.id}>
                  <td className="font-[var(--apex-font-body)] text-[var(--apex-text-primary)]">
                    <div>{run.name}</div>
                    <div className="mt-1 text-[11px] text-[var(--apex-text-tertiary)]">{run.symbol ?? "all"} · {run.timeframe}</div>
                  </td>
                  <td>{run.status}</td>
                  <td>{run.summary?.sampleSize ?? "—"}</td>
                  <td>{run.summary?.winRate != null ? `${(run.summary.winRate * 100).toFixed(1)}%` : "—"}</td>
                  <td>{run.summary?.expectancy != null ? `${run.summary.expectancy.toFixed(2)}R` : "—"}</td>
                  <td>{run.summary?.maxDrawdown != null ? `${run.summary.maxDrawdown.toFixed(2)}R` : "—"}</td>
                </tr>
              ))}
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="apex-empty-state">
                    {isLoading ? "Loading backtest runs…" : "No backtest runs available yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
