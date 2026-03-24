"use client";

import { useEffect, useState } from "react";
import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

interface Stats {
  users: { total: number; pending: number; activeToday: number; banned: number };
  signals: { total: number; b: number; a: number; s: number };
  recentUsers: { id: string; name: string | null; email: string; status: string; createdAt: string }[];
  recentSignals: { id: string; asset: string; direction: string; rank: string; total: number; createdAt: string }[];
}

const STATUS_COLORS: Record<string, string> = {
  PENDING:   "text-yellow-400 bg-yellow-400/10",
  APPROVED:  "text-green-400 bg-green-400/10",
  SUSPENDED: "text-orange-400 bg-orange-400/10",
  BANNED:    "text-red-400 bg-red-400/10",
};

const RANK_COLORS: Record<string, string> = {
  S: "text-amber-300",
  A: "text-emerald-400",
  B: "text-sky-400",
};

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-5">
      <p className="text-xs text-zinc-500 tracking-widest uppercase mb-1">{label}</p>
      <p className="text-3xl font-bold text-zinc-100">{value}</p>
      {sub && <p className="text-xs text-zinc-600 mt-1">{sub}</p>}
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
    return <div className="text-zinc-500 text-sm">Loading...</div>;
  }
  if (!stats) {
    return <div className="text-red-400 text-sm">{error ?? "Failed to load stats."}</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-zinc-100 mb-1">Overview</h1>
        <p className="text-xs text-zinc-500">System health and recent activity</p>
      </div>

      {/* User stats */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Users</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Users"       value={stats.users.total} />
          <StatCard label="Pending Approval"  value={stats.users.pending}    sub="Awaiting review" />
          <StatCard label="Active Today"       value={stats.users.activeToday} sub="Logged in today" />
          <StatCard label="Banned"             value={stats.users.banned} />
        </div>
      </section>

      {/* Signal stats */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Signals</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Signals" value={stats.signals.total} />
          <StatCard label="S Rank"         value={stats.signals.s} sub="Score ≥85" />
          <StatCard label="A Rank"         value={stats.signals.a} sub="Score 70-84" />
          <StatCard label="B Rank"         value={stats.signals.b} sub="Score 55-69" />
        </div>
      </section>

      {/* Recent signups */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Recent Signups</h2>
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Email</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Joined</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentUsers.map(u => (
                <tr key={u.id} className="border-b border-zinc-900 hover:bg-zinc-900/50">
                  <td className="px-4 py-3 text-zinc-100">{u.name ?? "—"}</td>
                  <td className="px-4 py-3 text-zinc-400">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${STATUS_COLORS[u.status] ?? "text-zinc-400"}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Recent signals */}
      <section>
        <h2 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase mb-3">Recent Signals</h2>
        <div className="bg-zinc-950 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                <th className="text-left px-4 py-3">Asset</th>
                <th className="text-left px-4 py-3">Direction</th>
                <th className="text-left px-4 py-3">Rank</th>
                <th className="text-left px-4 py-3">Score</th>
                <th className="text-left px-4 py-3">Generated</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentSignals.map(s => (
                <tr key={s.id} className="border-b border-zinc-900 hover:bg-zinc-900/50">
                  <td className="px-4 py-3 font-mono text-zinc-100">{s.asset}</td>
                  <td className={`px-4 py-3 font-medium ${s.direction === "LONG" ? "text-green-400" : "text-red-400"}`}>
                    {s.direction}
                  </td>
                  <td className={`px-4 py-3 font-bold ${RANK_COLORS[s.rank] ?? "text-zinc-400"}`}>{s.rank}</td>
                  <td className="px-4 py-3 text-zinc-400">{s.total}/100</td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {new Date(s.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
