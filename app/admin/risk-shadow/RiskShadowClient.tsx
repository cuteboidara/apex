"use client";

import { useEffect, useState } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

type RiskShadowPayload = {
  mismatchRate: number;
  total: number;
  mismatches: number;
  safeToPromote: boolean;
  ruleBreakdown: Record<string, { legacy: number; shadow: number; mismatch: number }>;
  dailyBreakdown: Array<{ date: string; mismatchRate: number; total: number }>;
  days: number;
};

export default function RiskShadowClient() {
  const [data, setData] = useState<RiskShadowPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await fetchJsonResponse<RiskShadowPayload>("/api/admin/risk-shadow?days=7");
      if (result.ok && result.data) {
        setData(result.data);
        setError(null);
      } else {
        setError(formatApiError(result, "Failed to load risk shadow metrics."));
      }
    })();
  }, []);

  if (error) {
    return <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-[var(--apex-status-blocked-text)]">{error}</div>;
  }
  if (!data) {
    return <div className="apex-empty-state">Loading shadow risk telemetry…</div>;
  }

  const rules = Object.entries(data.ruleBreakdown)
    .map(([ruleCode, counts]) => ({ ruleCode, ...counts }))
    .sort((left, right) => right.mismatch - left.mismatch);

  return (
    <div className="space-y-6">
      <section className={`apex-surface px-6 py-6 ${data.safeToPromote ? "border-[var(--apex-status-active-border)]" : "border-[var(--apex-status-watchlist-border)]"}`}>
        <p className="apex-eyebrow">Observability</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          Shadow risk mismatch
        </h2>
        <p className={`mt-4 text-[14px] ${data.safeToPromote ? "text-[var(--apex-status-active-text)]" : "text-[var(--apex-status-watchlist-text)]"}`}>
          {data.safeToPromote
            ? "SAFE TO PROMOTE — shadow risk modules are stable."
            : `NOT YET — ${data.mismatchRate}% mismatch. Continue monitoring before cutover.`}
        </p>
      </section>

      <div className="apex-admin-kpi-grid">
        <div className="apex-admin-kpi">
          <p className="apex-admin-kpi-label">Mismatch Rate</p>
          <p className="mt-4 font-[var(--apex-font-mono)] text-[42px] text-[var(--apex-text-primary)]">{data.mismatchRate}%</p>
          <p className="apex-admin-kpi-detail">{data.days}-day window</p>
        </div>
        <div className="apex-admin-kpi">
          <p className="apex-admin-kpi-label">Comparisons</p>
          <p className="mt-4 font-[var(--apex-font-mono)] text-[42px] text-[var(--apex-text-primary)]">{data.total}</p>
          <p className="apex-admin-kpi-detail">Legacy vs shadow evaluations</p>
        </div>
        <div className="apex-admin-kpi">
          <p className="apex-admin-kpi-label">Mismatches</p>
          <p className="mt-4 font-[var(--apex-font-mono)] text-[42px] text-[var(--apex-status-watchlist-text)]">{data.mismatches}</p>
          <p className="apex-admin-kpi-detail">Divergent decisions or rules</p>
        </div>
      </div>

      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Trend</p>
        <div className="mt-4 grid gap-3 md:grid-cols-7">
          {data.dailyBreakdown.map(day => (
            <div key={day.date} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3">
              <p className="font-[var(--apex-font-mono)] text-[10px] text-[var(--apex-text-tertiary)]">{day.date}</p>
              <div className="mt-3 h-28 rounded-full bg-[var(--apex-bg-elevated)]">
                <div className="h-full rounded-full bg-[var(--apex-status-watchlist-text)]" style={{ width: `${Math.max(4, day.mismatchRate)}%` }} />
              </div>
              <p className="mt-3 text-[12px] text-[var(--apex-text-primary)]">{day.mismatchRate}%</p>
            </div>
          ))}
        </div>
      </section>

      <section className="apex-table-shell overflow-hidden">
        <div className="overflow-x-auto px-6 py-5">
          <table className="apex-table min-w-[760px]">
            <thead>
              <tr>
                <th>Rule Code</th>
                <th>Legacy Fires</th>
                <th>Shadow Fires</th>
                <th>Mismatch</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.ruleCode}>
                  <td className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{rule.ruleCode}</td>
                  <td>{rule.legacy}</td>
                  <td>{rule.shadow}</td>
                  <td>{rule.mismatch}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
