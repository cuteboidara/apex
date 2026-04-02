"use client";

import { useEffect, useState } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";
import type { LiveRuntimeSmokeReport, ProviderReliabilitySummary } from "@/src/application/analytics/alphaTypes";

type DataQualityPayload = {
  pairs: Array<{
    symbol: string;
    candleFetchSuccessRate: number;
    degradedRate: number;
    livePriceNullRate: number;
    totalSnapshots: number;
  }>;
  twelveData: {
    status: string;
    lastSuccessAt: string;
    latencyMs: number | null;
    detail: string | null;
  } | null;
  cotData: {
    status: string;
    lastReportAt: string;
    daysOld: number;
  } | null;
  cycleLatency: {
    averageMs: number;
    samples: number;
  };
  providerReliability: ProviderReliabilitySummary[];
  liveSmoke: LiveRuntimeSmokeReport | null;
};

function formatRate(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

export default function DataQualityPage() {
  const [data, setData] = useState<DataQualityPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const result = await fetchJsonResponse<DataQualityPayload>("/api/admin/data-quality");
      if (result.ok && result.data) {
        setData(result.data);
      } else {
        setError(formatApiError(result, "Failed to load data quality metrics."));
      }
    })();
  }, []);

  if (error) return <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-[var(--apex-status-blocked-text)]">{error}</div>;
  if (!data) return <div className="apex-empty-state">Loading data quality metrics…</div>;

  return (
    <div className="space-y-6">
      <section className="apex-surface px-6 py-6">
        <p className="apex-eyebrow">Observability</p>
        <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
          Data quality
        </h2>
      </section>

      <div className="apex-admin-kpi-grid">
        <div className="apex-admin-kpi">
          <p className="apex-admin-kpi-label">Twelve Data</p>
          <p className="mt-4 text-[17px] font-semibold text-[var(--apex-text-primary)]">{data.twelveData?.status ?? "unknown"}</p>
          <p className="apex-admin-kpi-detail">Latency {data.twelveData?.latencyMs ?? 0} ms</p>
        </div>
        <div className="apex-admin-kpi">
          <p className="apex-admin-kpi-label">COT Freshness</p>
          <p className="mt-4 text-[17px] font-semibold text-[var(--apex-text-primary)]">{data.cotData?.daysOld ?? "—"} days</p>
          <p className="apex-admin-kpi-detail">{data.cotData?.status ?? "No COT health"}</p>
        </div>
        <div className="apex-admin-kpi">
          <p className="apex-admin-kpi-label">Cycle Latency</p>
          <p className="mt-4 text-[17px] font-semibold text-[var(--apex-text-primary)]">{data.cycleLatency.averageMs} ms</p>
          <p className="apex-admin-kpi-detail">{data.cycleLatency.samples} samples</p>
        </div>
        <div className="apex-admin-kpi">
          <p className="apex-admin-kpi-label">Provider Summaries</p>
          <p className="mt-4 text-[17px] font-semibold text-[var(--apex-text-primary)]">{data.providerReliability.length}</p>
          <p className="apex-admin-kpi-detail">72h reliability windows across asset-class providers</p>
        </div>
      </div>

      <section className="apex-table-shell overflow-hidden">
        <div className="overflow-x-auto px-6 py-5">
          <table className="apex-table min-w-[820px]">
            <thead>
              <tr>
                <th>Pair</th>
                <th>Candle Fetch Success</th>
                <th>Degraded Rate</th>
                <th>Live Price Null Rate</th>
                <th>Samples</th>
              </tr>
            </thead>
            <tbody>
              {data.pairs.map(pair => (
                <tr key={pair.symbol}>
                  <td className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{pair.symbol}</td>
                  <td>{pair.candleFetchSuccessRate}%</td>
                  <td>{pair.degradedRate}%</td>
                  <td>{pair.livePriceNullRate}%</td>
                  <td>{pair.totalSnapshots}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="apex-table-shell overflow-hidden">
        <div className="px-6 py-5">
          <div className="mb-4">
            <p className="apex-eyebrow">Provider Reliability</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Recent provider ranking</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="apex-table min-w-[920px]">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Asset</th>
                  <th>Score</th>
                  <th>Success Rate</th>
                  <th>Degraded</th>
                  <th>Empty Body</th>
                  <th>Latency</th>
                  <th>Last Success</th>
                </tr>
              </thead>
              <tbody>
                {data.providerReliability.map((row, index) => (
                  <tr key={`${row.provider}-${row.assetClass}-${index}`}>
                    <td className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{row.provider}</td>
                    <td>{row.assetClass}</td>
                    <td>{row.recentScore}</td>
                    <td>{formatRate(row.successRate)}</td>
                    <td>{row.degradedResponses}</td>
                    <td>{row.emptyBodyResponses}</td>
                    <td>{row.averageLatencyMs != null ? `${row.averageLatencyMs}ms` : "—"}</td>
                    <td>{row.lastSuccessfulAt ? new Date(row.lastSuccessfulAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {data.liveSmoke ? (
        <section className="apex-table-shell overflow-hidden">
          <div className="px-6 py-5">
            <div className="mb-4">
              <p className="apex-eyebrow">Live Smoke</p>
              <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Latest runtime verification summary</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="apex-table min-w-[920px]">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Runtime</th>
                    <th>Provider</th>
                    <th>Providers Observed</th>
                    <th>Null Prices</th>
                    <th>Freshness</th>
                    <th>Blocked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.liveSmoke.rows.map(row => (
                    <tr key={row.assetClass}>
                      <td className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{row.assetClass}</td>
                      <td>{row.runtimeHealth}</td>
                      <td>{row.providerStatus ?? "unknown"}</td>
                      <td>{row.providersObserved.join(", ") || row.providerChain.join(" -> ")}</td>
                      <td>{row.nullPriceCount}</td>
                      <td>{row.averageFreshnessMs != null ? `${Math.round(row.averageFreshnessMs / 1000)}s avg` : "—"}</td>
                      <td>{row.stageCounts.blockedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
