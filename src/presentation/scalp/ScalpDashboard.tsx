"use client";

import { useEffect, useMemo, useState } from "react";

type DashboardView = "all" | "gates" | "history" | "stats";

type ScalpSignal = {
  id: string;
  assetId: string;
  direction: "long" | "short";
  setupType: string;
  score: number;
  gate1Trend: number;
  gate2Level: number;
  gate3Momentum: number;
  gate4Candle: number;
  gate5Context: number;
  keyLevelType: string;
  keyLevelPrice: number;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  status: string;
  outcomePnl: number | null;
  createdAt: string;
};

type ScalpStats = {
  total: number;
  wins: number;
  losses: number;
  closed: number;
  active: number;
  winRate: number;
  totalPnl: number;
  currentSession?: string;
};

type ScalpResponse = {
  active: ScalpSignal[];
  recent: ScalpSignal[];
  stats: ScalpStats;
};

function isScalpResponse(value: unknown): value is ScalpResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<ScalpResponse>;
  return Array.isArray(row.active) && Array.isArray(row.recent) && typeof row.stats === "object" && row.stats != null;
}

const REFRESH_MS = 15 * 60 * 1000;

function toFixedSafe(value: number | null | undefined, digits: number): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";
}

export function ScalpDashboard({ view = "all" }: { view?: DashboardView }) {
  const [data, setData] = useState<ScalpResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycling, setCycling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchData() {
    try {
      const response = await fetch("/api/scalp/signals", { cache: "no-store" });
      const payload = await response.json() as unknown;
      if (!response.ok) {
        const message = typeof payload === "object" && payload && "error" in payload
          ? String((payload as { error?: unknown }).error ?? "Failed to fetch scalp data")
          : "Failed to fetch scalp data";
        throw new Error(message);
      }

      if (!isScalpResponse(payload)) {
        throw new Error("Invalid scalp API response");
      }

      setData(payload);
      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchData();
    const timer = window.setInterval(() => {
      void fetchData();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  async function runCycle() {
    setCycling(true);
    setError(null);

    try {
      const response = await fetch("/api/scalp/cycle", { method: "POST" });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Scalp cycle failed");
      }
      await fetchData();
    } catch (cycleError) {
      setError(cycleError instanceof Error ? cycleError.message : String(cycleError));
    } finally {
      setCycling(false);
    }
  }

  const activeSignals = data?.active ?? [];
  const recentSignals = data?.recent ?? [];
  const stats = data?.stats;

  const title = useMemo(() => {
    if (view === "gates") return "SCALP GATES MONITOR";
    if (view === "history") return "SCALP HISTORY";
    if (view === "stats") return "SCALP PERFORMANCE";
    return "SCALP COMMAND";
  }, [view]);

  if (loading) {
    return <div className="p-6 font-mono text-sm text-slate-500">Loading scalp signals...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl font-bold text-white">{title}</h1>
          <p className="mt-0.5 font-mono text-xs text-slate-500">
            5-Gate Confluence · 15m entries · 1-4h holds · Session: {stats?.currentSession ?? "-"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runCycle()}
          disabled={cycling}
          className="rounded border border-amber-500/50 bg-amber-500/10 px-4 py-2 font-mono text-xs text-amber-400 transition-colors hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cycling ? "SCANNING..." : "SCAN NOW"}
        </button>
      </div>

      {error ? (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-3 font-mono text-xs text-red-300">
          {error}
        </div>
      ) : null}

      {(view === "all" || view === "stats") && stats ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Active" value={stats.active} color="text-white" />
          <StatCard label="Win Rate" value={`${stats.winRate}%`} color={stats.winRate >= 60 ? "text-emerald-400" : "text-amber-400"} />
          <StatCard label="Wins / Losses" value={`${stats.wins} / ${stats.losses}`} color="text-slate-300" />
          <StatCard label="Closed" value={stats.closed} color="text-slate-300" />
          <StatCard label="Total PnL" value={`$${toFixedSafe(stats.totalPnl, 0)}`} color={stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"} />
        </div>
      ) : null}

      {(view === "all" || view === "gates") && (
        <section>
          <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Active Setups ({activeSignals.length})
          </div>
          {activeSignals.length === 0 ? (
            <div className="rounded-xl border border-slate-800 p-8 text-center">
              <div className="font-mono text-sm text-slate-500">No setups pass all 5 gates</div>
              <div className="mt-2 font-mono text-xs text-slate-600">The system is waiting for clean confluence.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              {activeSignals.map(signal => (
                <ScalpSignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </section>
      )}

      {(view === "all" || view === "history") && (
        <section>
          <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-slate-500">Recent Outcomes</div>
          <div className="overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-xs font-mono">
              <thead className="border-b border-slate-800 bg-slate-900">
                <tr>
                  <th className="p-3 text-left text-[10px] text-slate-500">Asset</th>
                  <th className="p-3 text-left text-[10px] text-slate-500">Dir</th>
                  <th className="p-3 text-left text-[10px] text-slate-500">Score</th>
                  <th className="p-3 text-left text-[10px] text-slate-500">Status</th>
                  <th className="p-3 text-left text-[10px] text-slate-500">PnL</th>
                  <th className="p-3 text-left text-[10px] text-slate-500">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentSignals.map(signal => (
                  <tr key={signal.id} className="border-b border-slate-800/50">
                    <td className="p-3 font-bold text-white">{signal.assetId}</td>
                    <td className={`p-3 ${signal.direction === "long" ? "text-emerald-400" : "text-red-400"}`}>
                      {signal.direction === "long" ? "LONG" : "SHORT"}
                    </td>
                    <td className="p-3 text-slate-300">{signal.score}</td>
                    <td className="p-3 text-slate-400">{signal.status}</td>
                    <td className={`p-3 ${typeof signal.outcomePnl === "number" && signal.outcomePnl < 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {signal.outcomePnl == null ? "-" : `${signal.outcomePnl >= 0 ? "+" : ""}$${toFixedSafe(signal.outcomePnl, 0)}`}
                    </td>
                    <td className="p-3 text-[10px] text-slate-600">{new Date(signal.createdAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recentSignals.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs text-slate-600">No closed scalp signals yet.</div>
            ) : null}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`font-mono text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function ScalpSignalCard({ signal }: { signal: ScalpSignal }) {
  const isLong = signal.direction === "long";
  const isExecutable = signal.score >= 75;

  const gates = [
    { label: "Trend", score: signal.gate1Trend, max: 20 },
    { label: "Level", score: signal.gate2Level, max: 20 },
    { label: "Mom", score: signal.gate3Momentum, max: 20 },
    { label: "Candle", score: signal.gate4Candle, max: 25 },
    { label: "Ctx", score: signal.gate5Context, max: 15 },
  ];

  return (
    <div className={`rounded-xl border p-4 ${isExecutable ? "border-amber-500/40 bg-amber-500/5" : "border-slate-800 bg-slate-900/60"}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-400">SCALP</span>
        <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${isExecutable ? "border-amber-500/40 text-amber-400" : "border-slate-600 text-slate-400"}`}>
          {isExecutable ? "EXECUTABLE" : "WATCHLIST"}
        </span>
      </div>

      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-mono text-xl font-bold text-white">{signal.assetId}</span>
        <span className={`font-mono text-sm ${isLong ? "text-emerald-400" : "text-red-400"}`}>{isLong ? "LONG" : "SHORT"}</span>
      </div>

      <div className="mb-3 grid grid-cols-5 gap-1">
        {gates.map(gate => (
          <div key={gate.label} className="text-center">
            <div className="mb-1 h-1 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-gradient-to-r from-amber-500 to-amber-400"
                style={{ width: `${Math.max(0, Math.min(100, (gate.score / gate.max) * 100))}%` }}
              />
            </div>
            <div className="font-mono text-[8px] text-slate-500">{gate.label}</div>
            <div className="font-mono text-[10px] text-slate-300">{gate.score}</div>
          </div>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded bg-slate-800/50 p-2">
          <div className="font-mono text-[9px] text-slate-500">SCORE</div>
          <div className="font-mono text-lg font-bold text-white">{signal.score}/100</div>
        </div>
        <div className="rounded bg-slate-800/50 p-2">
          <div className="font-mono text-[9px] text-slate-500">KEY LEVEL</div>
          <div className="truncate font-mono text-[11px] text-slate-300">{signal.keyLevelType.replaceAll("_", " ")}</div>
        </div>
      </div>

      <div className="space-y-1 border-t border-slate-800 pt-2 font-mono text-[11px]">
        <div className="flex justify-between"><span className="text-slate-500">Entry</span><span className="text-white">{toFixedSafe(signal.entryPrice, 5)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">SL</span><span className="text-red-400">{toFixedSafe(signal.stopLoss, 5)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">TP1</span><span className="text-emerald-400">{toFixedSafe(signal.tp1, 5)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">TP2</span><span className="text-emerald-400">{toFixedSafe(signal.tp2, 5)}</span></div>
      </div>
    </div>
  );
}
