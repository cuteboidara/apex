"use client";

import { useEffect, useState } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";

type RiskRulesPayload = {
  days: number;
  rules: Array<{
    ruleCode: string;
    description: string;
    fires: number;
    signalsBlocked: number;
    pairsAffected: string[];
    sessions: string[];
  }>;
};

export default function RiskRulesPage() {
  const [data, setData] = useState<RiskRulesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await fetchJsonResponse<RiskRulesPayload>("/api/admin/risk-rules?days=7");
      if (result.ok && result.data) {
        setData(result.data);
      } else {
        setError(formatApiError(result, "Failed to load risk rule distribution."));
      }
    })();
  }, []);

  if (error) return <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-[var(--apex-status-blocked-text)]">{error}</div>;
  if (!data) return <div className="apex-empty-state">Loading risk rules…</div>;

  return (
    <div className="space-y-6">
      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Observability</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          Rule distribution
        </h2>
      </section>
      <section className="apex-table-shell overflow-hidden">
        <div className="overflow-x-auto px-6 py-5">
          <table className="apex-table min-w-[1080px]">
            <thead>
              <tr>
                <th>Rule Code</th>
                <th>Description</th>
                <th>Fires (7d)</th>
                <th>Signals Blocked</th>
                <th>Pairs</th>
                <th>Sessions</th>
              </tr>
            </thead>
            <tbody>
              {data.rules.map(rule => (
                <tr key={rule.ruleCode}>
                  <td className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{rule.ruleCode}</td>
                  <td>{rule.description}</td>
                  <td>{rule.fires}</td>
                  <td>{rule.signalsBlocked}</td>
                  <td>{rule.pairsAffected.join(", ")}</td>
                  <td>{rule.sessions.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
