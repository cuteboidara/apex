"use client";

import { useEffect, useState } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

type ConversionPayload = {
  days: number;
  totals: {
    candidates: number;
    executable: number;
    candidateToExecutableRate: number;
  };
  byPair: Array<{ symbol: string; candidates: number; executable: number; conversionRate: number }>;
  byStrategy: Array<{ strategy: string; candidates: number; executable: number; conversionRate: number }>;
  bySession: Array<{ session: string; candidates: number; executable: number; conversionRate: number }>;
  gradeDistribution: Array<{ grade: string; count: number }>;
};

export default function ConversionPage() {
  const [data, setData] = useState<ConversionPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await fetchJsonResponse<ConversionPayload>("/api/admin/conversion?days=7");
      if (result.ok && result.data) {
        setData(result.data);
      } else {
        setError(formatApiError(result, "Failed to load conversion metrics."));
      }
    })();
  }, []);

  if (error) return <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-[var(--apex-status-blocked-text)]">{error}</div>;
  if (!data) return <div className="apex-empty-state">Loading conversion metrics…</div>;

  return (
    <div className="space-y-6">
      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Observability</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          Conversion rates
        </h2>
      </section>

      <div className="apex-admin-kpi-grid">
        <div className="apex-admin-kpi">
          <p className="apex-admin-kpi-label">Candidates</p>
          <p className="mt-4 font-[var(--apex-font-mono)] text-[42px] text-[var(--apex-text-primary)]">{data.totals.candidates}</p>
        </div>
        <div className="apex-admin-kpi">
          <p className="apex-admin-kpi-label">Executable</p>
          <p className="mt-4 font-[var(--apex-font-mono)] text-[42px] text-[var(--apex-status-active-text)]">{data.totals.executable}</p>
        </div>
        <div className="apex-admin-kpi">
          <p className="apex-admin-kpi-label">Conversion Rate</p>
          <p className="mt-4 font-[var(--apex-font-mono)] text-[42px] text-[var(--apex-status-watchlist-text)]">{data.totals.candidateToExecutableRate}%</p>
        </div>
      </div>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="apex-table-shell overflow-hidden">
          <div className="overflow-x-auto px-6 py-5">
            <table className="apex-table min-w-[560px]">
              <thead>
                <tr>
                  <th>Pair</th>
                  <th>Candidates</th>
                  <th>Executable</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.byPair.map(row => (
                  <tr key={row.symbol}>
                    <td className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{row.symbol}</td>
                    <td>{row.candidates}</td>
                    <td>{row.executable}</td>
                    <td>{row.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="apex-table-shell overflow-hidden">
          <div className="overflow-x-auto px-6 py-5">
            <table className="apex-table min-w-[560px]">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Candidates</th>
                  <th>Executable</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.byStrategy.map(row => (
                  <tr key={row.strategy}>
                    <td>{row.strategy}</td>
                    <td>{row.candidates}</td>
                    <td>{row.executable}</td>
                    <td>{row.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="apex-table-shell overflow-hidden">
          <div className="overflow-x-auto px-6 py-5">
            <table className="apex-table min-w-[560px]">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Candidates</th>
                  <th>Executable</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.bySession.map(row => (
                  <tr key={row.session}>
                    <td>{row.session}</td>
                    <td>{row.candidates}</td>
                    <td>{row.executable}</td>
                    <td>{row.conversionRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="apex-surface px-6 py-6">
          <p className="apex-eyebrow">Grade Distribution</p>
          <div className="mt-4 space-y-3">
            {data.gradeDistribution.map(row => (
              <div key={row.grade}>
                <div className="flex items-center justify-between gap-3">
                  <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-primary)]">{row.grade}</p>
                  <p className="text-[12px] text-[var(--apex-text-secondary)]">{row.count}</p>
                </div>
                <div className="mt-2 h-2 rounded-full bg-[var(--apex-bg-elevated)]">
                  <div className="h-2 rounded-full bg-[var(--apex-text-accent)]" style={{ width: `${Math.max(4, row.count * 8)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
