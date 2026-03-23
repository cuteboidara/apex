"use client";

import { useEffect, useState, useTransition } from "react";

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
  const [isPending, startTransition] = useTransition();

  const loadRuns = () => {
    fetch("/api/backtest")
      .then(res => res.json())
      .then(data => setRuns(data.runs ?? []))
      .catch(err => setError(String(err)));
  };

  useEffect(() => {
    loadRuns();
  }, []);

  const runBacktest = () => {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/backtest", {
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
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error ?? "Backtest failed.");
        return;
      }
      loadRuns();
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 mb-1">Backtests</h1>
        <p className="text-xs text-zinc-500">Run deterministic replays against persisted candles.</p>
      </div>

      <section className="bg-zinc-950 border border-zinc-800 rounded-lg p-5 space-y-4">
        <div className="grid md:grid-cols-3 gap-4">
          <label className="space-y-1 text-sm">
            <span className="text-zinc-500">Symbol</span>
            <input className="w-full bg-black border border-zinc-800 rounded px-3 py-2" value={form.symbol} onChange={event => setForm(current => ({ ...current, symbol: event.target.value.toUpperCase() }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-500">Asset Class</span>
            <select className="w-full bg-black border border-zinc-800 rounded px-3 py-2" value={form.assetClass} onChange={event => setForm(current => ({ ...current, assetClass: event.target.value }))}>
              <option value="FOREX">FOREX</option>
              <option value="COMMODITY">COMMODITY</option>
              <option value="CRYPTO">CRYPTO</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-500">Style</span>
            <select className="w-full bg-black border border-zinc-800 rounded px-3 py-2" value={form.style} onChange={event => setForm(current => ({ ...current, style: event.target.value }))}>
              <option value="SCALP">SCALP</option>
              <option value="INTRADAY">INTRADAY</option>
              <option value="SWING">SWING</option>
            </select>
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-500">Spread Bps</span>
            <input className="w-full bg-black border border-zinc-800 rounded px-3 py-2" value={form.spreadBps} onChange={event => setForm(current => ({ ...current, spreadBps: event.target.value }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-500">Slippage Bps</span>
            <input className="w-full bg-black border border-zinc-800 rounded px-3 py-2" value={form.slippageBps} onChange={event => setForm(current => ({ ...current, slippageBps: event.target.value }))} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-zinc-500">Confidence Floor</span>
            <input className="w-full bg-black border border-zinc-800 rounded px-3 py-2" value={form.confidenceFloor} onChange={event => setForm(current => ({ ...current, confidenceFloor: event.target.value }))} />
          </label>
        </div>
        <button onClick={runBacktest} disabled={isPending} className="px-4 py-2 rounded bg-emerald-400 text-black font-medium disabled:opacity-60">
          {isPending ? "Running..." : "Run Replay"}
        </button>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </section>

      <section className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-zinc-500 text-xs border-b border-zinc-800">
            <tr>
              <th className="text-left px-4 py-3">Run</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Sample</th>
              <th className="text-left px-4 py-3">Win Rate</th>
              <th className="text-left px-4 py-3">Expectancy</th>
              <th className="text-left px-4 py-3">Drawdown</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(run => (
              <tr key={run.id} className="border-b border-zinc-900">
                <td className="px-4 py-3 text-zinc-100">
                  <div>{run.name}</div>
                  <div className="text-xs text-zinc-500">{run.symbol ?? "all"} · {run.timeframe}</div>
                </td>
                <td className="px-4 py-3 text-zinc-300">{run.status}</td>
                <td className="px-4 py-3 text-zinc-300">{run.summary?.sampleSize ?? "—"}</td>
                <td className="px-4 py-3 text-zinc-300">{run.summary?.winRate != null ? `${(run.summary.winRate * 100).toFixed(1)}%` : "—"}</td>
                <td className="px-4 py-3 text-zinc-300">{run.summary?.expectancy != null ? `${run.summary.expectancy.toFixed(2)}R` : "—"}</td>
                <td className="px-4 py-3 text-zinc-300">{run.summary?.maxDrawdown != null ? `${run.summary.maxDrawdown.toFixed(2)}R` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
