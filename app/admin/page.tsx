"use client";

import { useEffect, useState } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";
import { RunControlPanel } from "@/src/presentation/dashboard/components/overview/RunControlPanel";

interface Stats {
  users: { total: number; pending: number; activeToday: number; banned: number };
  signals: { total: number; b: number; a: number; s: number };
  recentUsers: { id: string; name: string | null; email: string; status: string; createdAt: string }[];
  recentSignals: { id: string; asset: string; direction: string; rank: string; total: number; createdAt: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "text-yellow-300 bg-yellow-300/10 border-yellow-300/20",
  APPROVED: "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]",
  SUSPENDED: "text-orange-300 bg-orange-300/10 border-orange-300/20",
  BANNED: "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]",
};

const RANK_COLORS: Record<string, string> = {
  S: "text-[var(--apex-grade-s)]",
  A: "text-[var(--apex-grade-a)]",
  B: "text-[var(--apex-grade-b)]",
};

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="apex-admin-kpi">
      <p className="apex-admin-kpi-label">{label}</p>
      <p className="apex-admin-kpi-value">{value}</p>
      {sub ? <p className="apex-admin-kpi-detail">{sub}</p> : null}
    </div>
  );
}

export default function AdminOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchJsonResponse<Stats>("/api/admin/stats")
      .then(result => {
        if (!result.ok || !result.data) {
          setStats(null);
          setError(formatApiError(result, "Failed to load stats."));
          return;
        }

        setStats(result.data);
        setError(null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="apex-empty-state">Loading admin overview…</div>;
  }

  if (!stats) {
    return (
      <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-sm text-[var(--apex-status-blocked-text)]">
        {error ?? "Failed to load stats."}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="apex-surface px-6 py-6">
        <div className="apex-toolbar gap-6">
          <div>
            <p className="apex-eyebrow">Control Overview</p>
            <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
              Runtime health and operator activity
            </h2>
            <p className="mt-3 max-w-[760px] text-[14px] text-[var(--apex-text-secondary)]">
              Unified visibility for user approvals, runtime signal quality, and the latest control-surface activity.
            </p>
          </div>
          <div className="apex-stack-card min-w-[220px]">
            <p className="apex-admin-kpi-label">Operator Snapshot</p>
            <p className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.06em] text-[var(--apex-text-primary)]">
              {stats.users.activeToday}
            </p>
            <p className="mt-2 text-[12px] text-[var(--apex-text-tertiary)]">Active today across the private operator surface.</p>
          </div>
        </div>
      </section>

      <RunControlPanel adminMode />

      <section className="space-y-4">
        <div>
          <p className="apex-eyebrow">User Signals</p>
          <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Core metrics</h3>
        </div>
        <div className="apex-admin-kpi-grid">
          <StatCard label="Total Users" value={stats.users.total} />
          <StatCard label="Pending Approval" value={stats.users.pending} sub="Awaiting review" />
          <StatCard label="Active Today" value={stats.users.activeToday} sub="Live sessions in the last day" />
          <StatCard label="Banned" value={stats.users.banned} />
          <StatCard label="Total Signals" value={stats.signals.total} />
          <StatCard label="S Rank" value={stats.signals.s} sub="Score ≥ 85" />
          <StatCard label="A Rank" value={stats.signals.a} sub="Score 70–84" />
          <StatCard label="B Rank" value={stats.signals.b} sub="Score 55–69" />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="apex-table-shell px-6 py-5">
          <div className="mb-4">
            <p className="apex-eyebrow">Recent Signups</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">New user intake</h3>
          </div>
          <table className="apex-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentUsers.map(user => (
                <tr key={user.id}>
                  <td className="font-[var(--apex-font-body)] text-[var(--apex-text-primary)]">{user.name ?? "—"}</td>
                  <td>{user.email}</td>
                  <td>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${STATUS_COLORS[user.status] ?? "text-[var(--apex-text-secondary)] border-[var(--apex-border-default)]"}`}>
                      {user.status}
                    </span>
                  </td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="apex-table-shell px-6 py-5">
          <div className="mb-4">
            <p className="apex-eyebrow">Recent Signals</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Live runtime output</h3>
          </div>
          <table className="apex-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Direction</th>
                <th>Rank</th>
                <th>Score</th>
                <th>Generated</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentSignals.map(signal => (
                <tr key={signal.id}>
                  <td className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{signal.asset}</td>
                  <td className={signal.direction === "LONG" ? "text-[var(--apex-status-active-text)]" : "text-[var(--apex-status-blocked-text)]"}>
                    {signal.direction}
                  </td>
                  <td className={`font-[var(--apex-font-display)] text-[15px] ${RANK_COLORS[signal.rank] ?? "text-[var(--apex-text-secondary)]"}`}>
                    {signal.rank}
                  </td>
                  <td>{signal.total}/100</td>
                  <td>{new Date(signal.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
