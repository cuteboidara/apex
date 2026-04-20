"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ASSET_SYMBOLS } from "@/src/indices/data/fetchers/assetConfig";

type RuntimeStatus = "live" | "idle" | "error";

type AdminStats = {
  runtimeStatus: RuntimeStatus;
  lastCycle: string | null;
  cycleLatency: number;
  assetsScanned: number;
  totalSignals: number;
  executableSignals: number;
  watchlistSignals: number;
  avgScore: number;
  signalsByAsset: Record<string, number>;
  signalsBySetup: Record<string, number>;
  totalUsers: number;
  activeUsers: number;
  pendingApprovals: number;
  newUsersToday: number;
  macroRegime: string;
  dxy: number;
  vix: number;
  eventRisk: number;
};

const EMPTY_STATS: AdminStats = {
  runtimeStatus: "idle",
  lastCycle: null,
  cycleLatency: 0,
  assetsScanned: 0,
  totalSignals: 0,
  executableSignals: 0,
  watchlistSignals: 0,
  avgScore: 0,
  signalsByAsset: {},
  signalsBySetup: {},
  totalUsers: 0,
  activeUsers: 0,
  pendingApprovals: 0,
  newUsersToday: 0,
  macroRegime: "NORMAL",
  dxy: 0,
  vix: 0,
  eventRisk: 0,
};

function readStats(payload: unknown): AdminStats {
  if (!payload || typeof payload !== "object") return EMPTY_STATS;
  const data = payload as Partial<AdminStats>;

  return {
    runtimeStatus: data.runtimeStatus === "live" || data.runtimeStatus === "error" ? data.runtimeStatus : "idle",
    lastCycle: typeof data.lastCycle === "string" ? data.lastCycle : null,
    cycleLatency: typeof data.cycleLatency === "number" ? data.cycleLatency : 0,
    assetsScanned: typeof data.assetsScanned === "number" ? data.assetsScanned : 0,
    totalSignals: typeof data.totalSignals === "number" ? data.totalSignals : 0,
    executableSignals: typeof data.executableSignals === "number" ? data.executableSignals : 0,
    watchlistSignals: typeof data.watchlistSignals === "number" ? data.watchlistSignals : 0,
    avgScore: typeof data.avgScore === "number" ? data.avgScore : 0,
    signalsByAsset: data.signalsByAsset && typeof data.signalsByAsset === "object" ? data.signalsByAsset : {},
    signalsBySetup: data.signalsBySetup && typeof data.signalsBySetup === "object" ? data.signalsBySetup : {},
    totalUsers: typeof data.totalUsers === "number" ? data.totalUsers : 0,
    activeUsers: typeof data.activeUsers === "number" ? data.activeUsers : 0,
    pendingApprovals: typeof data.pendingApprovals === "number" ? data.pendingApprovals : 0,
    newUsersToday: typeof data.newUsersToday === "number" ? data.newUsersToday : 0,
    macroRegime: typeof data.macroRegime === "string" ? data.macroRegime : "NORMAL",
    dxy: typeof data.dxy === "number" ? data.dxy : 0,
    vix: typeof data.vix === "number" ? data.vix : 0,
    eventRisk: typeof data.eventRisk === "number" ? data.eventRisk : 0,
  };
}

export function AdminCommandCenter() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycling, setCycling] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(() => new Date());
  const [cycleError, setCycleError] = useState<string | null>(null);

  useEffect(() => {
    void fetchStats();
    const interval = window.setInterval(() => {
      void fetchStats();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, []);

  async function fetchStats() {
    try {
      const response = await fetch("/api/admin/stats", { cache: "no-store" });
      const data = await response.json() as unknown;
      setStats(readStats(data));
      setLastRefresh(new Date());
    } catch (error) {
      console.error("[admin-command-center] Failed to fetch admin stats:", error);
      setStats(EMPTY_STATS);
    } finally {
      setLoading(false);
    }
  }

  async function runAmtCycle() {
    setCycling(true);
    setCycleError(null);
    try {
      const response = await fetch("/api/indices/amt/cycle", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quick: true }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? "AMT cycle trigger failed.");
      }
      await fetchStats();
    } catch (error) {
      setCycleError(error instanceof Error ? error.message : "AMT cycle trigger failed.");
    } finally {
      setCycling(false);
    }
  }

  if (loading || !stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="animate-pulse font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-tertiary)]">Loading admin data...</div>
      </div>
    );
  }

  const executablePct = stats.totalSignals > 0
    ? Math.round((stats.executableSignals / stats.totalSignals) * 100)
    : 0;
  const expectedAssetCount = ASSET_SYMBOLS.length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--apex-font-mono)] text-xl font-bold text-[var(--apex-text-primary)]">ADMIN COMMAND CENTER</h1>
          <p className="mt-0.5 font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-tertiary)]">
            APEX V2 · AMT TRADER RUNTIME · Last refresh: {lastRefresh.toLocaleTimeString()}
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => void fetchStats()}
            className="rounded border border-[var(--apex-border-default)] px-4 py-2 font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)] transition-colors hover:text-[var(--apex-text-primary)]"
          >
            REFRESH
          </button>
          <button
            onClick={() => void runAmtCycle()}
            disabled={cycling}
            className={`rounded border px-4 py-2 font-[var(--apex-font-mono)] text-xs transition-colors ${cycling
              ? "cursor-not-allowed border-[var(--apex-border-default)] text-[var(--apex-text-tertiary)]"
              : "border-cyan-500/50 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20"
            }`}
          >
            {cycling ? "RUNNING CYCLE..." : "RUN AMT CYCLE"}
          </button>
        </div>
      </div>
      {cycleError ? (
        <div className="rounded-lg border border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] px-4 py-3 font-[var(--apex-font-mono)] text-xs text-[var(--apex-status-blocked-text)]">
          Cycle error: {cycleError}
        </div>
      ) : null}

      <section>
        <div className="mb-3 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-widest text-[var(--apex-text-tertiary)]">System Health</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="RUNTIME"
            value={stats.runtimeStatus.toUpperCase()}
            valueColor={stats.runtimeStatus === "live" ? "text-green-400" : "text-red-400"}
            sub="AMT · Paper Trading"
          />
          <KpiCard
            label="LAST CYCLE"
            value={stats.lastCycle ? new Date(stats.lastCycle).toLocaleTimeString() : "Never"}
            valueColor="text-blue-300"
            sub={`${stats.cycleLatency}ms latency`}
          />
          <KpiCard
            label="ASSETS SCANNED"
            value={`${stats.assetsScanned}/${expectedAssetCount}`}
            valueColor={stats.assetsScanned >= expectedAssetCount ? "text-green-400" : "text-yellow-400"}
            sub="All AMT assets"
          />
          <KpiCard
            label="EVENT RISK"
            value={stats.eventRisk}
            valueColor={stats.eventRisk > 5 ? "text-red-400" : "text-[var(--apex-text-primary)]"}
            sub="Upcoming economic events"
          />
        </div>
      </section>

      <section>
        <div className="mb-3 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-widest text-[var(--apex-text-tertiary)]">Signal Performance</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="TOTAL SIGNALS" value={stats.totalSignals} sub="All time (paper trading)" />
          <KpiCard label="EXECUTABLE" value={stats.executableSignals} valueColor="text-green-400" sub={`${executablePct}% of total`} />
          <KpiCard label="WATCHLIST" value={stats.watchlistSignals} valueColor="text-yellow-400" sub="Score 40-59" />
          <KpiCard
            label="AVG SCORE"
            value={`${stats.avgScore.toFixed(1)}/100`}
            valueColor={stats.avgScore >= 60 ? "text-green-400" : "text-yellow-400"}
            sub="All paper signals"
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
          <BreakdownCard title="Signals by Asset" data={stats.signalsByAsset} />
          <BreakdownCard
            title="Signals by Setup"
            data={stats.signalsBySetup}
            labelMap={{
              breakout_acceptance: "Breakout Acceptance",
              failed_auction_long: "Failed Auction Long",
              failed_auction_short: "Failed Auction Short",
            }}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-widest text-[var(--apex-text-tertiary)]">User Metrics</div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="TOTAL USERS" value={stats.totalUsers} sub="All registered" />
          <KpiCard label="ACTIVE" value={stats.activeUsers} valueColor="text-green-400" sub="Last 7 days" />
          <KpiCard
            label="PENDING APPROVAL"
            value={stats.pendingApprovals}
            valueColor={stats.pendingApprovals > 0 ? "text-yellow-400" : "text-[var(--apex-text-primary)]"}
            sub={stats.pendingApprovals > 0 ? "Action required" : "All clear"}
            action={stats.pendingApprovals > 0 ? { label: "Review ->", href: "/admin/users/approvals" } : undefined}
          />
          <KpiCard label="NEW TODAY" value={stats.newUsersToday} valueColor="text-blue-300" sub="Signups in last 24h" />
        </div>
      </section>

      <section>
        <div className="mb-3 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-widest text-[var(--apex-text-tertiary)]">Macro Context</div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-lg border border-[var(--apex-border-default)] bg-[var(--apex-surface-muted)] p-4 xl:col-span-1">
            <div className="mb-2 font-[var(--apex-font-mono)] text-[10px] text-[var(--apex-text-tertiary)]">AMT MACRO REGIME</div>
            <div className="mb-1 font-[var(--apex-font-mono)] text-2xl font-bold text-[var(--apex-text-primary)]">{stats.macroRegime}</div>
            <div className="font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)]">
              DXY {stats.dxy.toFixed(1)} · VIX {stats.vix.toFixed(1)}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--apex-border-default)] bg-[var(--apex-surface-muted)] p-4 xl:col-span-2">
            <div className="mb-3 font-[var(--apex-font-mono)] text-[10px] text-[var(--apex-text-tertiary)]">QUICK ACTIONS</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <QuickAction label="View Signals" href="/admin/signals" />
              <QuickAction label="Manage Assets" href="/admin/assets" />
              <QuickAction label="User Approvals" href="/admin/users/approvals" />
              <QuickAction label="Runtime Health" href="/admin/system" />
              <QuickAction label="Telegram" href="/admin/telegram" />
              <QuickAction label="All Users" href="/admin/users" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  valueColor = "text-[var(--apex-text-primary)]",
  action,
}: {
  label: string;
  value: string | number;
  sub: string;
  valueColor?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-lg border border-[var(--apex-border-default)] bg-[var(--apex-surface-muted)] p-4">
      <div className="mb-2 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-widest text-[var(--apex-text-tertiary)]">{label}</div>
      <div className={`mb-1 font-[var(--apex-font-mono)] text-2xl font-bold ${valueColor}`}>{value}</div>
      <div className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-tertiary)]">{sub}</div>
      {action ? (
        <Link href={action.href} className="mt-2 inline-block font-[var(--apex-font-mono)] text-[10px] text-cyan-300 hover:text-cyan-200">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

function BreakdownCard({
  title,
  data,
  labelMap = {},
}: {
  title: string;
  data: Record<string, number>;
  labelMap?: Record<string, string>;
}) {
  const total = Object.values(data).reduce((sum, count) => sum + count, 0);
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);

  return (
    <div className="rounded-lg border border-[var(--apex-border-default)] bg-[var(--apex-surface-muted)] p-4">
      <div className="mb-3 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-widest text-[var(--apex-text-tertiary)]">{title}</div>
      {entries.length === 0 ? (
        <div className="font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-tertiary)]">No data yet</div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, count]) => {
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={key} className="flex items-center gap-3">
                <div className="w-32 truncate font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)]">{labelMap[key] ?? key}</div>
                <div className="h-1.5 flex-1 rounded-full bg-[var(--apex-border-default)]">
                  <div className="h-1.5 rounded-full bg-cyan-400" style={{ width: `${pct}%` }} />
                </div>
                <div className="w-8 text-right font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-tertiary)]">{count}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuickAction({ label, href }: { label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded border border-[var(--apex-border-default)] p-2 transition-colors hover:bg-[var(--apex-surface-card)]"
    >
      <span className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">{label}</span>
    </Link>
  );
}
