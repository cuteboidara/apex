"use client";

import { useEffect, useMemo, useState } from "react";

type DashboardView = "all" | "active" | "history" | "stats";

type SniperSignal = {
  id: string;
  assetId: string;
  setupType: string;
  direction: "long" | "short";
  score: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  sessionName: string;
  status: string;
  outcomePnl: number | null;
  createdAt: string;
};

type SniperStats = {
  total: number;
  wins: number;
  losses: number;
  closed: number;
  active: number;
  winRate: number;
  totalPnl: number;
  engine?: string;
  currentSession?: string;
};

type SniperAssetState = {
  assetId: string;
  symbol: string;
  category: string;
  lastScanned: string | null;
  lastPrice: number | null;
  hasActiveSignal: boolean;
  dataStatus: "never" | "ready" | "no_data" | "error";
};

type SniperResponse = {
  active: SniperSignal[];
  recent: SniperSignal[];
  stats: SniperStats;
};

type SniperCycleResponse = {
  cycleId: string;
  engine: string;
  assetsScanned: number;
  assetsWithData: number;
  signals: Array<{ id: string }>;
};

function isSniperResponse(value: unknown): value is SniperResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SniperResponse>;
  return Array.isArray(row.active) && Array.isArray(row.recent) && typeof row.stats === "object" && row.stats != null;
}

function isSniperStateArray(value: unknown): value is SniperAssetState[] {
  return Array.isArray(value);
}

const REFRESH_MS = 15 * 60 * 1000;

function toFixedSafe(value: number | null | undefined, digits: number): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "-";
}

export function SniperDashboard({ view = "all" }: { view?: DashboardView }) {
  const [data, setData] = useState<SniperResponse | null>(null);
  const [assetStates, setAssetStates] = useState<SniperAssetState[]>([]);
  const [loading, setLoading] = useState(true);
  const [cycling, setCycling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<string | null>(null);

  async function fetchData() {
    try {
      const [signalsResponse, statesResponse] = await Promise.all([
        fetch("/api/sniper/signals", { cache: "no-store" }),
        fetch("/api/sniper/state", { cache: "no-store" }),
      ]);

      const payload = await signalsResponse.json() as unknown;
      if (!signalsResponse.ok) {
        const err = typeof payload === "object" && payload && "error" in payload
          ? String((payload as { error?: unknown }).error ?? "Failed to fetch sniper data")
          : "Failed to fetch sniper data";
        throw new Error(err);
      }
      if (!isSniperResponse(payload)) {
        throw new Error("Invalid sniper API response");
      }
      setData(payload);

      const statePayload = await statesResponse.json().catch(() => null) as unknown;
      if (statesResponse.ok && isSniperStateArray(statePayload)) {
        setAssetStates(statePayload);
      } else {
        setAssetStates([]);
      }
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
      const response = await fetch("/api/sniper/cycle", { method: "POST" });
      const payload = await response.json().catch(() => null) as (SniperCycleResponse & { error?: string }) | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Sniper cycle failed");
      }
      if (payload) {
        setLastRun(
          `${payload.engine} · scanned ${payload.assetsScanned}/${payload.assetsWithData} data-ready · signals ${payload.signals?.length ?? 0}`,
        );
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
    if (view === "active") return "SNIPER ACTIVE TRADES";
    if (view === "history") return "SNIPER HISTORY";
    if (view === "stats") return "SNIPER PERFORMANCE";
    return "SNIPER COMMAND";
  }, [view]);

  if (loading) {
    return <div className="p-6 font-mono text-sm text-slate-500">Loading sniper signals...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-mono text-xl font-bold text-white">{title}</h1>
          <p className="mt-0.5 font-mono text-xs text-slate-500">
            15m tactical entries · 1-48h holds · Session: {stats?.currentSession ?? "-"} · Engine: {stats?.engine ?? "-"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void runCycle()}
          disabled={cycling}
          className="rounded border border-red-500/50 bg-red-500/10 px-4 py-2 font-mono text-xs text-red-400 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cycling ? "SCANNING..." : "SCAN NOW"}
        </button>
      </div>

      {error ? (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-4 py-3 font-mono text-xs text-red-300">
          {error}
        </div>
      ) : null}
      {lastRun ? (
        <div className="rounded border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 font-mono text-xs text-cyan-200">
          Last scan: {lastRun}
        </div>
      ) : null}

      {(view === "all" || view === "stats") && stats ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Active" value={stats.active} color="text-white" />
          <StatCard label="Total Signals" value={stats.total} color="text-slate-300" />
          <StatCard label="Win Rate" value={`${stats.winRate}%`} color={stats.winRate >= 50 ? "text-emerald-400" : "text-red-400"} />
          <StatCard label="Wins / Losses" value={`${stats.wins} / ${stats.losses}`} color="text-slate-300" />
          <StatCard label="Closed" value={stats.closed} color="text-slate-300" />
          <StatCard label="Total PnL" value={`$${toFixedSafe(stats.totalPnl, 0)}`} color={stats.totalPnl >= 0 ? "text-emerald-400" : "text-red-400"} />
        </div>
      ) : null}

      {view === "all" ? (
        <section>
          <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Assets Monitored ({assetStates.length})
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
            {assetStates.map(asset => (
              <div key={asset.assetId} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-white">{asset.assetId}</span>
                  <span
                    className={[
                      "font-mono text-[9px] uppercase",
                      asset.dataStatus === "ready" ? "text-emerald-400" : asset.dataStatus === "error" ? "text-red-400" : "text-amber-400",
                    ].join(" ")}
                  >
                    {asset.dataStatus}
                  </span>
                </div>
                <div className="font-mono text-[10px] text-slate-500">{asset.symbol}</div>
                <div className="mt-1 font-mono text-[10px] text-slate-400">
                  {asset.lastScanned ? new Date(asset.lastScanned).toLocaleTimeString() : "not scanned"}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {(view === "all" || view === "active") && (
        <section>
          <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Active Signals ({activeSignals.length})
          </div>
          {activeSignals.length === 0 ? (
            <div className="rounded-xl border border-slate-800 p-8 text-center">
              <div className="font-mono text-sm text-slate-500">No active sniper setups</div>
              <div className="mt-2 font-mono text-xs text-slate-600">Waiting for liquidity sweeps in active sessions.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {activeSignals.map(signal => (
                <SniperSignalCard key={signal.id} signal={signal} />
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
                  <th className="p-3 text-left text-[10px] text-slate-500">Entry</th>
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
                    <td className="p-3 text-slate-400">{signal.score}</td>
                    <td className="p-3 text-slate-300">{toFixedSafe(signal.entryPrice, 5)}</td>
                    <td className="p-3 text-slate-300">{signal.status}</td>
                    <td className={`p-3 ${typeof signal.outcomePnl === "number" && signal.outcomePnl < 0 ? "text-red-400" : "text-emerald-400"}`}>
                      {signal.outcomePnl == null ? "-" : `${signal.outcomePnl >= 0 ? "+" : ""}$${toFixedSafe(signal.outcomePnl, 0)}`}
                    </td>
                    <td className="p-3 text-[10px] text-slate-600">{new Date(signal.createdAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recentSignals.length === 0 ? (
              <div className="p-6 text-center font-mono text-xs text-slate-600">No closed sniper signals yet.</div>
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

function SniperSignalCard({ signal }: { signal: SniperSignal }) {
  const executable = signal.score >= 70;
  const long = signal.direction === "long";
  return (
    <div className={`rounded-xl border p-4 ${executable ? "border-red-500/40 bg-red-500/5" : "border-slate-800 bg-slate-900/60"}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="rounded bg-red-500/10 px-2 py-0.5 font-mono text-[10px] text-red-400">SNIPER</span>
        <span className={`rounded border px-2 py-0.5 font-mono text-[10px] ${executable ? "border-red-500/40 text-red-400" : "border-amber-500/40 text-amber-400"}`}>
          {executable ? "EXECUTABLE" : "WATCHLIST"}
        </span>
      </div>

      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-mono text-lg font-bold text-white">{signal.assetId}</span>
        <span className={`font-mono text-sm ${long ? "text-emerald-400" : "text-red-400"}`}>{long ? "LONG" : "SHORT"}</span>
      </div>
      <div className="mb-3 font-mono text-[10px] text-slate-500">{signal.setupType.replaceAll("_", " ").toUpperCase()} · {signal.sessionName}</div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded bg-slate-800/50 p-2">
          <div className="font-mono text-[9px] text-slate-500">SCORE</div>
          <div className="font-mono text-lg font-bold text-white">{signal.score}/100</div>
        </div>
        <div className="rounded bg-slate-800/50 p-2">
          <div className="font-mono text-[9px] text-slate-500">RR</div>
          <div className="font-mono text-lg font-bold text-white">{toFixedSafe(signal.riskReward, 2)}:1</div>
        </div>
      </div>

      <div className="space-y-1 border-t border-slate-800 pt-2 font-mono text-[11px]">
        <div className="flex justify-between"><span className="text-slate-500">Entry</span><span className="text-white">{toFixedSafe(signal.entryPrice, 5)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">SL</span><span className="text-red-400">{toFixedSafe(signal.stopLoss, 5)}</span></div>
        <div className="flex justify-between"><span className="text-slate-500">TP</span><span className="text-emerald-400">{toFixedSafe(signal.takeProfit, 5)}</span></div>
      </div>
    </div>
  );
}
