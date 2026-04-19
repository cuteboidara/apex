"use client";

import { useEffect, useMemo, useState } from "react";

type SignalFilter = "all" | "executable" | "watchlist";

type Signal = {
  id: string;
  assetId: string;
  setupType: string;
  direction: string;
  score: number;
  entryZone: { high: number | null; low: number | null; mid: number | null };
  stopLoss: number | null;
  tp1: number | null;
  riskRewardRatio: number | null;
  createdAt: string;
};

export default function AdminSignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [filter, setFilter] = useState<SignalFilter>("all");
  const [assetFilter, setAssetFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/admin/signals?limit=1000", { cache: "no-store" });
        const payload = await response.json() as { signals?: Signal[] };
        if (cancelled) return;
        setSignals(Array.isArray(payload.signals) ? payload.signals : []);
      } catch {
        if (cancelled) return;
        setSignals([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const assets = useMemo(
    () => Array.from(new Set(signals.map(signal => signal.assetId))).sort(),
    [signals],
  );

  const filtered = useMemo(() => {
    return signals.filter(signal => {
      if (filter === "executable" && signal.score < 60) return false;
      if (filter === "watchlist" && (signal.score < 40 || signal.score >= 60)) return false;
      if (assetFilter !== "all" && signal.assetId !== assetFilter) return false;
      return true;
    });
  }, [assetFilter, filter, signals]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--apex-font-mono)] text-lg font-bold text-[var(--apex-text-primary)]">AMT SIGNAL BOARD</h1>
          <p className="font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-tertiary)]">All signals from paper trading and live cycles</p>
        </div>

        <div className="flex gap-2">
          {(["all", "executable", "watchlist"] as const).map(current => (
            <button
              key={current}
              onClick={() => setFilter(current)}
              className={`rounded border px-3 py-1 font-[var(--apex-font-mono)] text-[10px] uppercase transition-colors ${filter === current
                ? "border-[var(--apex-text-primary)] bg-[var(--apex-text-primary)] text-[var(--apex-surface-bg)]"
                : "border-[var(--apex-border-default)] text-[var(--apex-text-secondary)] hover:text-[var(--apex-text-primary)]"
              }`}
            >
              {current}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setAssetFilter("all")}
          className={`rounded px-2 py-0.5 font-[var(--apex-font-mono)] text-[10px] ${assetFilter === "all"
            ? "bg-[var(--apex-text-secondary)] text-[var(--apex-surface-bg)]"
            : "text-[var(--apex-text-tertiary)] hover:text-[var(--apex-text-primary)]"
          }`}
        >
          ALL
        </button>
        {assets.map(asset => (
          <button
            key={asset}
            onClick={() => setAssetFilter(asset)}
            className={`rounded px-2 py-0.5 font-[var(--apex-font-mono)] text-[10px] ${assetFilter === asset
              ? "bg-[var(--apex-text-secondary)] text-[var(--apex-surface-bg)]"
              : "text-[var(--apex-text-tertiary)] hover:text-[var(--apex-text-primary)]"
            }`}
          >
            {asset}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--apex-border-default)]">
        <table className="w-full font-[var(--apex-font-mono)] text-xs">
          <thead className="border-b border-[var(--apex-border-default)] bg-[var(--apex-surface-card)]">
            <tr>
              <th className="p-3 text-left text-[10px] uppercase text-[var(--apex-text-tertiary)]">Asset</th>
              <th className="p-3 text-left text-[10px] uppercase text-[var(--apex-text-tertiary)]">Setup</th>
              <th className="p-3 text-left text-[10px] uppercase text-[var(--apex-text-tertiary)]">Direction</th>
              <th className="p-3 text-left text-[10px] uppercase text-[var(--apex-text-tertiary)]">Score</th>
              <th className="p-3 text-left text-[10px] uppercase text-[var(--apex-text-tertiary)]">Entry</th>
              <th className="p-3 text-left text-[10px] uppercase text-[var(--apex-text-tertiary)]">SL</th>
              <th className="p-3 text-left text-[10px] uppercase text-[var(--apex-text-tertiary)]">RR</th>
              <th className="p-3 text-left text-[10px] uppercase text-[var(--apex-text-tertiary)]">Time</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-tertiary)]">
                  Loading AMT signals...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-tertiary)]">
                  No signals match the current filter.
                </td>
              </tr>
            ) : (
              filtered.map(signal => (
                <tr key={signal.id} className="border-b border-[var(--apex-border-default)]/50 hover:bg-[var(--apex-surface-card)]/40">
                  <td className="p-3 font-bold text-[var(--apex-text-primary)]">{signal.assetId}</td>
                  <td className="p-3 text-[var(--apex-text-secondary)]">{signal.setupType.replaceAll("_", " ")}</td>
                  <td className={`p-3 ${signal.direction === "long" ? "text-[var(--apex-status-active-text)]" : "text-[var(--apex-status-blocked-text)]"}`}>
                    {signal.direction.toUpperCase()}
                  </td>
                  <td className="p-3">
                    <span className={`rounded px-2 py-0.5 text-[10px] ${signal.score >= 60
                      ? "border border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] text-[var(--apex-status-active-text)]"
                      : signal.score >= 40
                        ? "border border-[var(--apex-status-watchlist-border)] bg-[var(--apex-status-watchlist-bg)] text-[var(--apex-status-watchlist-text)]"
                        : "bg-[var(--apex-surface-card)] text-[var(--apex-text-tertiary)]"
                    }`}>
                      {signal.score.toFixed(1)}
                    </span>
                  </td>
                  <td className="p-3 text-[var(--apex-text-secondary)]">{signal.entryZone.mid != null ? signal.entryZone.mid.toFixed(4) : "-"}</td>
                  <td className="p-3 text-[var(--apex-status-blocked-text)]">{signal.stopLoss != null ? signal.stopLoss.toFixed(4) : "-"}</td>
                  <td className="p-3 text-[var(--apex-text-secondary)]">{signal.riskRewardRatio != null ? `${signal.riskRewardRatio.toFixed(2)}:1` : "-"}</td>
                  <td className="p-3 text-[var(--apex-text-tertiary)]">{new Date(signal.createdAt).toLocaleTimeString()}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
