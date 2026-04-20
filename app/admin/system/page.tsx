"use client";

import { useEffect, useState, type FormEvent } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";
import type { AlphaAnalyticsReport, LiveRuntimeSmokeDashboard, LiveRuntimeSmokeReport, ProviderReliabilitySummary, RuntimeHealthState } from "@/src/application/analytics/alphaTypes";
import type { DailyAlphaReportSummary } from "@/src/application/analytics/dailyAlphaReport";

interface SystemData {
  latestRun: {
    id: string;
    status: string;
    queuedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    totalDurationMs: number | null;
    failureCode: string | null;
    failureReason: string | null;
  } | null;
  queue: { pending: number; failed: number };
  envStatus: Record<string, boolean>;
  dbStatus: string;
  providerHealth: { provider: string; status: string; latencyMs: number | null; errorRate: number | null; recordedAt: string }[];
  optionalProviderHealth?: { provider: string; status: string; latencyMs: number | null; errorRate: number | null; recordedAt: string }[];
  liveSmokeReport?: LiveRuntimeSmokeReport | null;
  liveSmokeDashboard?: LiveRuntimeSmokeDashboard | null;
  alphaAnalytics?: AlphaAnalyticsReport | null;
  providerReliability?: ProviderReliabilitySummary[];
  latestDailyAlphaReport?: DailyAlphaReportSummary | null;
}

interface RuntimeHealthData {
  core: {
    status: string;
    detail: string;
    databaseStatus: string;
    queueStatus: string;
    marketDataStatus: string;
    engineStatus: string;
  };
  commentary: {
    status: string;
    provider: string;
    mode: string;
    detail: string;
  };
  news: {
    status: string;
    provider: string;
    detail: string;
    failedFeeds: string[];
  };
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}

function formatTimestamp(value: number | null | undefined) {
  return typeof value === "number" ? new Date(value).toLocaleString() : "—";
}

function formatRate(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

function formatSignedMetric(value: number | null | undefined) {
  return typeof value === "number" ? `${value > 0 ? "+" : ""}${value.toFixed(2)}R` : "—";
}

function getRuntimeTone(status: RuntimeHealthState | string): "good" | "warn" | "bad" | "neutral" {
  const normalized = String(status).toLowerCase();
  if (normalized === "healthy" || normalized === "available") return "good";
  if (normalized === "degraded") return "warn";
  if (normalized === "broken" || normalized === "offline") return "bad";
  return "neutral";
}

function getPromotionTone(status: string): "good" | "warn" | "bad" | "neutral" {
  const normalized = status.toLowerCase();
  if (normalized === "promotion_ready" || normalized === "production" || normalized === "analytically_ready") return "good";
  if (normalized === "analytically_strong_uncalibrated" || normalized === "shadow_validating") return "warn";
  if (normalized === "provider_limited" || normalized === "runtime_broken") return "bad";
  return "neutral";
}

export default function AdminSystemPage() {
  const [data, setData] = useState<SystemData | null>(null);
  const [runtime, setRuntime] = useState<RuntimeHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cycleLoading, setCycleLoading] = useState(false);
  const [cycleResult, setCycleResult] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [manualOutcome, setManualOutcome] = useState({
    tradePlanId: "",
    signalId: "",
    outcome: "TP1",
    realizedRR: "",
    note: "",
  });
  const [manualOutcomeLoading, setManualOutcomeLoading] = useState(false);
  const [manualOutcomeResult, setManualOutcomeResult] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [adminResult, runtimeResult] = await Promise.all([
      fetchJsonResponse<SystemData>("/api/admin/system"),
      fetchJsonResponse<RuntimeHealthData>("/api/system"),
    ]);

    if (adminResult.ok && adminResult.data) {
      setData(adminResult.data);
    } else {
      setData(null);
      setError(formatApiError(adminResult, "Failed to load system status."));
    }

    if (runtimeResult.ok && runtimeResult.data) {
      setRuntime(runtimeResult.data);
    } else {
      setRuntime(null);
      if (adminResult.ok && adminResult.data) {
        setError(formatApiError(runtimeResult, "Runtime health telemetry is unavailable."));
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [adminResult, runtimeResult] = await Promise.all([
        fetchJsonResponse<SystemData>("/api/admin/system"),
        fetchJsonResponse<RuntimeHealthData>("/api/system"),
      ]);

      if (cancelled) {
        return;
      }

      if (adminResult.ok && adminResult.data) {
        setData(adminResult.data);
      } else {
        setData(null);
        setError(formatApiError(adminResult, "Failed to load system status."));
      }

      if (runtimeResult.ok && runtimeResult.data) {
        setRuntime(runtimeResult.data);
      } else {
        setRuntime(null);
        if (adminResult.ok && adminResult.data) {
          setError(formatApiError(runtimeResult, "Runtime health telemetry is unavailable."));
        }
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function triggerCycle() {
    setCycleLoading(true);
    setCycleResult(null);
    try {
      const result = await fetchJsonResponse<{
        ok: boolean;
        cycleId?: string;
        executableCount?: number;
        watchlistCount?: number;
        error?: string;
      }>("/api/indices/amt/cycle", {
        method: "POST",
      });
      const payload = result.data;
      setCycleResult(
        payload?.ok
          ? `AMT cycle complete · executable ${payload?.executableCount ?? 0} · watchlist ${payload?.watchlistCount ?? 0}${payload?.cycleId ? ` · ${payload.cycleId}` : ""}`
          : formatApiError(result, "AMT cycle trigger failed."),
      );
      await load();
    } catch (loadError) {
      setCycleResult(String(loadError));
    }
    setCycleLoading(false);
  }

  async function runSystemAction(action: "run_live_smoke" | "refresh_alpha_analytics" | "run_daily_alpha_report") {
    setActionLoading(action);
    setActionResult(null);
    try {
      const result = await fetchJsonResponse<{
        ok: boolean;
        action?: string;
        liveSmokeReport?: LiveRuntimeSmokeReport | null;
        alphaAnalytics?: AlphaAnalyticsReport | null;
        dailyAlphaReport?: DailyAlphaReportSummary | null;
        error?: string;
      }>("/api/admin/system", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action,
          includeSmoke: true,
        }),
      });

      const payload = result.data;
      if (result.ok && payload?.ok) {
        setActionResult(
          action === "run_live_smoke"
            ? `Live smoke captured at ${formatTimestamp(payload.liveSmokeReport?.generatedAt)}`
            : action === "refresh_alpha_analytics"
              ? `Alpha analytics refreshed at ${formatTimestamp(payload.alphaAnalytics?.generatedAt)}`
              : `Daily alpha report ${payload.dailyAlphaReport?.delivery === "telegram_sent" ? "sent" : "stored"} at ${formatTimestamp(payload.dailyAlphaReport?.generatedAt)}`,
        );
        await load();
      } else {
        setActionResult(formatApiError(result, "System action failed."));
      }
    } catch (loadError) {
      setActionResult(String(loadError));
    }
    setActionLoading(null);
  }

  async function submitManualOutcome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setManualOutcomeLoading(true);
    setManualOutcomeResult(null);
    try {
      const result = await fetchJsonResponse<{
        ok: boolean;
        outcome?: string;
        tradePlanId?: string;
        realizedRR?: number | null;
        error?: string;
      }>("/api/admin/validation", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "manual_outcome_entry",
          tradePlanId: manualOutcome.tradePlanId || null,
          signalId: manualOutcome.signalId || null,
          outcome: manualOutcome.outcome,
          realizedRR: manualOutcome.realizedRR === "" ? null : Number(manualOutcome.realizedRR),
          note: manualOutcome.note || null,
        }),
      });

      if (result.ok && result.data?.ok) {
        setManualOutcomeResult(`Manual outcome recorded for ${result.data.tradePlanId ?? "trade plan"} as ${result.data.outcome ?? manualOutcome.outcome}.`);
        setManualOutcome({
          tradePlanId: "",
          signalId: "",
          outcome: "TP1",
          realizedRR: "",
          note: "",
        });
        await load();
      } else {
        setManualOutcomeResult(formatApiError(result, "Manual outcome entry failed."));
      }
    } catch (loadError) {
      setManualOutcomeResult(String(loadError));
    }
    setManualOutcomeLoading(false);
  }

  if (loading) {
    return <div className="apex-empty-state">Loading system control…</div>;
  }

  if (!data) {
    return (
      <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-sm text-[var(--apex-status-blocked-text)]">
        {error ?? "Failed to load system status."}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="apex-surface px-6 py-6">
        <div className="apex-toolbar gap-6">
          <div>
            <p className="apex-eyebrow">System Control</p>
            <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
              Runtime health and intervention controls
            </h2>
            <p className="mt-3 max-w-[820px] text-[14px] leading-7 text-[var(--apex-text-secondary)]">
              Canonical cycle telemetry, provider readiness, and operator action controls for the focused FX runtime.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button onClick={triggerCycle} disabled={cycleLoading} className="apex-button apex-button-amber disabled:opacity-60">
              {cycleLoading ? "Triggering" : "Trigger Signal Cycle"}
            </button>
            <button onClick={() => void runSystemAction("run_live_smoke")} disabled={actionLoading != null} className="apex-button disabled:opacity-60">
              {actionLoading === "run_live_smoke" ? "Running Smoke" : "Run Live Smoke"}
            </button>
            <button onClick={() => void runSystemAction("refresh_alpha_analytics")} disabled={actionLoading != null} className="apex-button disabled:opacity-60">
              {actionLoading === "refresh_alpha_analytics" ? "Refreshing Alpha" : "Refresh Alpha Analytics"}
            </button>
            <button onClick={() => void runSystemAction("run_daily_alpha_report")} disabled={actionLoading != null} className="apex-button disabled:opacity-60">
              {actionLoading === "run_daily_alpha_report" ? "Sending Report" : "Run Daily Alpha Report"}
            </button>
          </div>
        </div>
        {cycleResult ? (
          <div className={`mt-5 rounded-[var(--apex-radius-md)] border px-4 py-3 text-sm ${cycleResult.toLowerCase().includes("failed") ? "border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-[var(--apex-status-blocked-text)]" : "border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] text-[var(--apex-status-active-text)]"}`}>
            {cycleResult}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-[var(--apex-radius-md)] border border-yellow-400/20 bg-yellow-400/8 px-4 py-3 text-sm text-yellow-200">
            {error}
          </div>
        ) : null}
        {actionResult ? (
          <div className={`mt-4 rounded-[var(--apex-radius-md)] border px-4 py-3 text-sm ${actionResult.toLowerCase().includes("failed") || actionResult.toLowerCase().includes("error") ? "border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-[var(--apex-status-blocked-text)]" : "border-[var(--apex-status-watchlist-border)] bg-[var(--apex-status-watchlist-bg)] text-[var(--apex-status-watchlist-text)]"}`}>
            {actionResult}
          </div>
        ) : null}
      </section>

      {runtime ? (
        <section className="space-y-4">
          <div>
            <p className="apex-eyebrow">Operational Health</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Runtime status surfaces</h3>
          </div>
          <div className="apex-admin-kpi-grid">
            <HealthCard label="Core" status={runtime.core.status} title={`DB ${runtime.core.databaseStatus} · Queue ${runtime.core.queueStatus}`} detail={runtime.core.detail} />
            <HealthCard label="Commentary" status={runtime.commentary.status} title={`${runtime.commentary.provider} · ${runtime.commentary.mode}`} detail={runtime.commentary.detail} />
            <HealthCard
              label="News"
              status={runtime.news.status}
              title={runtime.news.failedFeeds.length > 0 ? `${runtime.news.provider} · ${runtime.news.failedFeeds.length} feed issues` : runtime.news.provider}
              detail={runtime.news.detail}
            />
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="apex-surface px-6 py-5">
          <div className="mb-4">
            <p className="apex-eyebrow">Latest Run</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Most recent cycle state</h3>
          </div>

          {data.latestRun ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${
                  data.latestRun.status === "COMPLETED"
                    ? "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]"
                    : data.latestRun.status === "RUNNING"
                      ? "text-[var(--apex-status-developing-text)] bg-[var(--apex-status-developing-bg)] border-[var(--apex-status-developing-border)]"
                      : data.latestRun.status === "FAILED"
                        ? "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]"
                        : "text-[var(--apex-text-secondary)] bg-[var(--apex-status-neutral-bg)] border-[var(--apex-status-neutral-border)]"
                }`}>
                  {data.latestRun.status}
                </span>
                <span className="apex-inline-meta">{data.latestRun.id}</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <DetailItem label="Queued" value={formatDate(data.latestRun.queuedAt)} />
                <DetailItem label="Started" value={formatDate(data.latestRun.startedAt)} />
                <DetailItem label="Completed" value={formatDate(data.latestRun.completedAt)} />
                <DetailItem valueClassName="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]" label="Duration" value={data.latestRun.totalDurationMs ? `${(data.latestRun.totalDurationMs / 1000).toFixed(1)}s` : "—"} />
              </div>

              {data.latestRun.failureReason ? (
                <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] px-4 py-3 text-sm text-[var(--apex-status-blocked-text)]">
                  {data.latestRun.failureCode}: {data.latestRun.failureReason}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="apex-empty-state px-0 py-8 text-left">No cycle runs have been recorded yet.</div>
          )}
        </div>

        <div className="space-y-6">
          <div className="apex-admin-kpi-grid">
            <StatusCard label="Database" status={data.dbStatus === "OK" ? "OK" : "ERROR"} />
            <StatusCard label="Alert Queue" status={data.queue.pending > 0 ? "PENDING" : "OK"} sub={`${data.queue.pending} pending / ${data.queue.failed} failed`} />
          </div>

          <div className="apex-surface px-6 py-5">
            <div className="mb-4">
              <p className="apex-eyebrow">Environment Variables</p>
              <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Critical runtime env state</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(data.envStatus).map(([key, isSet]) => (
                <div key={key} className="apex-stack-card flex items-center gap-3 px-4 py-3">
                  <span className={`h-2 w-2 rounded-full ${isSet ? "bg-[var(--apex-status-active-text)]" : "bg-[var(--apex-status-blocked-text)]"}`} />
                  <span className="flex-1 font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">{key}</span>
                  <span className={`font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] ${isSet ? "text-[var(--apex-status-active-text)]" : "text-[var(--apex-status-blocked-text)]"}`}>
                    {isSet ? "Set" : "Missing"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {data.providerHealth.length > 0 ? (
        <ProviderTable title="Core Provider Health" rows={data.providerHealth} />
      ) : null}

      {(data.optionalProviderHealth?.length ?? 0) > 0 ? (
        <ProviderTable title="Optional Services" rows={data.optionalProviderHealth ?? []} />
      ) : null}

      {data.liveSmokeReport ? (
        <section className="apex-table-shell px-6 py-5">
          <div className="mb-4">
            <p className="apex-eyebrow">Live Verification</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Latest runtime smoke report</h3>
            <p className="mt-2 text-[12px] text-[var(--apex-text-tertiary)]">{formatTimestamp(data.liveSmokeReport.generatedAt)}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="apex-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Runtime</th>
                  <th>Provider Status</th>
                  <th>Observed Providers</th>
                  <th>Stages</th>
                  <th>Null Prices</th>
                  <th>Freshness</th>
                  <th>Publication</th>
                </tr>
              </thead>
              <tbody>
                {data.liveSmokeReport.rows.map(row => (
                  <tr key={row.assetClass}>
                    <td className="font-[var(--apex-font-mono)] uppercase tracking-[0.12em] text-[var(--apex-text-primary)]">{row.assetClass}</td>
                    <td>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${getRuntimeTone(row.runtimeHealth) === "good" ? "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]" : getRuntimeTone(row.runtimeHealth) === "warn" ? "text-[var(--apex-status-watchlist-text)] bg-[var(--apex-status-watchlist-bg)] border-[var(--apex-status-watchlist-border)]" : getRuntimeTone(row.runtimeHealth) === "bad" ? "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]" : "text-[var(--apex-text-secondary)] bg-[var(--apex-status-neutral-bg)] border-[var(--apex-status-neutral-border)]"}`}>
                        {row.runtimeHealth.replaceAll("_", " ")}
                      </span>
                    </td>
                    <td>{row.providerStatus ?? "unknown"}</td>
                    <td>{row.providersObserved.join(", ") || row.providerChain.join(" -> ")}</td>
                    <td className="text-xs">
                      {row.stageCounts.marketSnapshotCount}/{row.stageCounts.tradeCandidateCount}/{row.stageCounts.executableSignalCount}/{row.stageCounts.publishedCount}
                    </td>
                    <td>{row.nullPriceCount}</td>
                    <td>{row.averageFreshnessMs != null ? `${Math.round(row.averageFreshnessMs / 1000)}s avg` : "—"}</td>
                    <td className="text-xs">
                      P {row.publicationDistribution.publishable ?? 0}
                      {" · "}W {row.publicationDistribution.watchlist_only ?? 0}
                      {" · "}S {row.publicationDistribution.shadow_only ?? 0}
                      {" · "}B {row.publicationDistribution.blocked ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data.liveSmokeDashboard ? (
        <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="apex-table-shell px-6 py-5">
            <div className="mb-4">
              <p className="apex-eyebrow">Smoke Dashboard</p>
              <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Runtime trend and last healthy cycle</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="apex-table min-w-[980px]">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Last Healthy</th>
                    <th>Null Trend</th>
                    <th>Transition</th>
                    <th>Providers</th>
                  </tr>
                </thead>
                <tbody>
                  {data.liveSmokeDashboard.rows.map(row => (
                    <tr key={`dashboard-${row.assetClass}`}>
                      <td className="font-[var(--apex-font-mono)] uppercase tracking-[0.12em] text-[var(--apex-text-primary)]">{row.assetClass}</td>
                      <td>{formatTimestamp(row.lastSuccessfulCycleAt)}</td>
                      <td className="text-xs text-[var(--apex-text-secondary)]">
                        {row.nullPriceTrend.map(point => `${Math.round(point.nullPriceRate * 100)}%`).join(" → ") || "—"}
                      </td>
                      <td>{row.transition ? `${row.transition.from} → ${row.transition.to}` : "stable"}</td>
                      <td>{row.providersObserved.join(", ") || row.providerChain.join(" -> ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="apex-surface px-6 py-5">
            <div className="mb-4">
              <p className="apex-eyebrow">Runtime Alerts</p>
              <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Health transitions</h3>
            </div>
            <div className="space-y-3">
              {data.liveSmokeDashboard.alerts.length > 0 ? data.liveSmokeDashboard.alerts.map(alert => (
                <div key={`${alert.assetClass}-${alert.changedAt}`} className="apex-stack-card px-4 py-4">
                  <p className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-accent)]">{alert.assetClass}</p>
                  <p className="mt-2 text-[13px] text-[var(--apex-text-primary)]">{alert.from} → {alert.to}</p>
                  <p className="mt-2 text-[12px] text-[var(--apex-text-tertiary)]">{formatTimestamp(alert.changedAt)}</p>
                </div>
              )) : (
                <p className="text-sm text-[var(--apex-text-tertiary)]">No runtime health transitions captured yet.</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {data.alphaAnalytics ? (
        <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <div className="apex-surface px-6 py-5">
            <div className="mb-4">
              <p className="apex-eyebrow">Alpha Readiness</p>
              <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Promotion readiness by asset class</h3>
            </div>
            <div className="space-y-3">
              {data.alphaAnalytics.promotionReadiness.map(row => (
                <div key={row.assetClass} className="apex-stack-card px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-accent)]">{row.assetClass}</p>
                      <p className="mt-2 text-[12px] text-[var(--apex-text-tertiary)]">{row.note}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${getRuntimeTone(row.runtimeHealth) === "good" ? "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]" : getRuntimeTone(row.runtimeHealth) === "warn" ? "text-[var(--apex-status-watchlist-text)] bg-[var(--apex-status-watchlist-bg)] border-[var(--apex-status-watchlist-border)]" : "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]"}`}>
                        {row.runtimeHealth.replaceAll("_", " ")}
                      </span>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${getPromotionTone(row.promotionState) === "good" ? "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]" : getPromotionTone(row.promotionState) === "warn" ? "text-[var(--apex-status-watchlist-text)] bg-[var(--apex-status-watchlist-bg)] border-[var(--apex-status-watchlist-border)]" : "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]"}`}>
                        {row.promotionState.replaceAll("_", " ")}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <DetailItem label="Sample Size" value={String(row.calibrationSampleSize)} />
                    <DetailItem label="Average Realized R" value={formatSignedMetric(row.averageRealizedR)} />
                    <DetailItem label="Provider Limited Rate" value={formatRate(row.providerLimitedRate)} />
                    <DetailItem label="Calibration State" value={row.calibrationState.replaceAll("_", " ")} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="apex-surface px-6 py-5">
            <div className="mb-4">
              <p className="apex-eyebrow">Calibration</p>
              <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Per-asset calibration summary</h3>
            </div>
            <div className="space-y-3">
              {data.alphaAnalytics.calibrationByAsset.map(summary => (
                <div key={summary.assetClass} className="apex-stack-card px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] text-[var(--apex-text-accent)]">{summary.assetClass}</p>
                      <p className="mt-2 text-[12px] text-[var(--apex-text-tertiary)]">{summary.calibrationVersion} · {summary.calibrationRegime}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${summary.confidenceReliabilityBand === "high" ? "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]" : summary.confidenceReliabilityBand === "medium" || summary.confidenceReliabilityBand === "low" ? "text-[var(--apex-status-watchlist-text)] bg-[var(--apex-status-watchlist-bg)] border-[var(--apex-status-watchlist-border)]" : "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]"}`}>
                        {summary.confidenceReliabilityBand}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <DetailItem label="Sample Size" value={String(summary.calibrationSampleSize)} />
                    <DetailItem label="Buckets" value={String(summary.buckets.length)} />
                    <DetailItem label="Raw Confidence" value={summary.rawConfidenceField} />
                    <DetailItem label="Calibrated Field" value={summary.calibratedConfidenceField} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {(data.providerReliability?.length ?? 0) > 0 ? (
        <section className="apex-table-shell px-6 py-5">
          <div className="mb-4">
            <p className="apex-eyebrow">Provider Reliability</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Recent provider score by asset class</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="apex-table min-w-[860px]">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Asset</th>
                  <th>Score</th>
                  <th>Success Rate</th>
                  <th>Latency</th>
                  <th>Attempts</th>
                  <th>Last Success</th>
                </tr>
              </thead>
              <tbody>
                {(data.providerReliability ?? []).slice(0, 18).map((row, index) => (
                  <tr key={`${row.provider}-${row.assetClass}-${index}`}>
                    <td className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{row.provider}</td>
                    <td>{row.assetClass}</td>
                    <td>{row.recentScore}</td>
                    <td>{formatRate(row.successRate)}</td>
                    <td>{row.averageLatencyMs != null ? `${row.averageLatencyMs}ms` : "—"}</td>
                    <td>{row.attempts}</td>
                    <td>{formatDate(row.lastSuccessfulAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="apex-surface px-6 py-5">
          <div className="mb-4">
            <p className="apex-eyebrow">Manual Outcomes</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Bootstrap non-FX samples</h3>
            <p className="mt-2 text-[12px] text-[var(--apex-text-tertiary)]">
              Record TP/SL outcomes manually when automated monitoring misses the lifecycle.
            </p>
          </div>
          <form onSubmit={submitManualOutcome} className="space-y-4">
            <label className="block text-sm text-[var(--apex-text-secondary)]">
              Trade Plan ID
              <input
                value={manualOutcome.tradePlanId}
                onChange={event => setManualOutcome(current => ({ ...current, tradePlanId: event.target.value }))}
                className="mt-2 w-full rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-surface)] px-3 py-2 text-sm text-[var(--apex-text-primary)]"
                placeholder="tradeplan_xxx"
              />
            </label>
            <label className="block text-sm text-[var(--apex-text-secondary)]">
              Signal ID
              <input
                value={manualOutcome.signalId}
                onChange={event => setManualOutcome(current => ({ ...current, signalId: event.target.value }))}
                className="mt-2 w-full rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-surface)] px-3 py-2 text-sm text-[var(--apex-text-primary)]"
                placeholder="signal_xxx"
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-[var(--apex-text-secondary)]">
                Outcome
                <select
                  value={manualOutcome.outcome}
                  onChange={event => setManualOutcome(current => ({ ...current, outcome: event.target.value }))}
                  className="mt-2 w-full rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-surface)] px-3 py-2 text-sm text-[var(--apex-text-primary)]"
                >
                  {["TP1", "TP2", "TP3", "STOP", "STOP_AFTER_TP1", "STOP_AFTER_TP2", "INVALIDATED", "EXPIRED"].map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-[var(--apex-text-secondary)]">
                Realized R
                <input
                  value={manualOutcome.realizedRR}
                  onChange={event => setManualOutcome(current => ({ ...current, realizedRR: event.target.value }))}
                  className="mt-2 w-full rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-surface)] px-3 py-2 text-sm text-[var(--apex-text-primary)]"
                  placeholder="1.5"
                />
              </label>
            </div>
            <label className="block text-sm text-[var(--apex-text-secondary)]">
              Note
              <textarea
                value={manualOutcome.note}
                onChange={event => setManualOutcome(current => ({ ...current, note: event.target.value }))}
                className="mt-2 min-h-[96px] w-full rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-surface)] px-3 py-2 text-sm text-[var(--apex-text-primary)]"
                placeholder="Optional operator note"
              />
            </label>
            <button type="submit" disabled={manualOutcomeLoading} className="apex-button disabled:opacity-60">
              {manualOutcomeLoading ? "Recording Outcome" : "Record Manual Outcome"}
            </button>
          </form>
          {manualOutcomeResult ? (
            <div className={`mt-4 rounded-[var(--apex-radius-md)] border px-4 py-3 text-sm ${manualOutcomeResult.toLowerCase().includes("failed") || manualOutcomeResult.toLowerCase().includes("error") ? "border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-[var(--apex-status-blocked-text)]" : "border-[var(--apex-status-active-border)] bg-[var(--apex-status-active-bg)] text-[var(--apex-status-active-text)]"}`}>
              {manualOutcomeResult}
            </div>
          ) : null}
        </div>

        <div className="apex-surface px-6 py-5">
          <div className="mb-4">
            <p className="apex-eyebrow">Daily Alpha Report</p>
            <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">Latest automated alpha summary</h3>
          </div>
          {data.latestDailyAlphaReport ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <DetailItem label="Generated" value={formatTimestamp(data.latestDailyAlphaReport.generatedAt)} />
                <DetailItem label="Delivery" value={data.latestDailyAlphaReport.delivery} />
              </div>
              <div className="apex-stack-card px-4 py-4">
                <p className="apex-admin-kpi-label">New Outcomes By Asset</p>
                <p className="mt-3 text-[13px] text-[var(--apex-text-primary)]">
                  {Object.entries(data.latestDailyAlphaReport.newOutcomesByAsset).map(([asset, count]) => `${asset}: ${count}`).join(" · ") || "No outcomes recorded"}
                </p>
              </div>
              <div className="apex-stack-card px-4 py-4">
                <p className="apex-admin-kpi-label">Calibration Alerts</p>
                <p className="mt-3 text-[13px] text-[var(--apex-text-primary)]">
                  {data.latestDailyAlphaReport.calibrationAlerts.join(" | ") || "No calibration alerts"}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--apex-text-tertiary)]">No daily alpha report has been generated yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function DetailItem({
  label,
  value,
  valueClassName = "font-[var(--apex-font-body)] text-[var(--apex-text-primary)]",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="apex-stack-card px-4 py-3">
      <p className="apex-admin-kpi-label">{label}</p>
      <p className={`mt-3 text-[13px] ${valueClassName}`}>{value}</p>
    </div>
  );
}

function StatusCard({ label, status, sub }: { label: string; status: string; sub?: string }) {
  const normalized = status.toUpperCase();
  const ok = normalized === "OK";
  const degraded = normalized === "PENDING" || normalized === "DEGRADED";
  return (
    <div className="apex-admin-kpi">
      <p className="apex-admin-kpi-label">{label}</p>
      <p className={`mt-4 text-[15px] font-semibold ${ok ? "text-[var(--apex-status-active-text)]" : degraded ? "text-[var(--apex-status-watchlist-text)]" : "text-[var(--apex-status-blocked-text)]"}`}>
        {status}
      </p>
      {sub ? <p className="apex-admin-kpi-detail">{sub}</p> : null}
    </div>
  );
}

function HealthCard({ label, status, title, detail }: { label: string; status: string; title: string; detail: string }) {
  const normalized = status.toLowerCase();
  const tone = normalized === "available"
    ? "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]"
    : normalized === "degraded"
      ? "text-[var(--apex-status-watchlist-text)] bg-[var(--apex-status-watchlist-bg)] border-[var(--apex-status-watchlist-border)]"
      : "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]";

  return (
    <div className="apex-admin-kpi">
      <div className="flex items-center justify-between gap-3">
        <p className="apex-admin-kpi-label">{label}</p>
        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${tone}`}>
          {status}
        </span>
      </div>
      <p className="mt-4 font-[var(--apex-font-display)] text-[19px] font-semibold tracking-[-0.04em] text-[var(--apex-text-primary)]">{title}</p>
      <p className="mt-3 text-[12px] leading-6 text-[var(--apex-text-secondary)]">{detail}</p>
    </div>
  );
}

function ProviderTable({
  title,
  rows,
}: {
  title: string;
  rows: { provider: string; status: string; latencyMs: number | null; errorRate: number | null; recordedAt: string }[];
}) {
  return (
    <section className="apex-table-shell px-6 py-5">
      <div className="mb-4">
        <p className="apex-eyebrow">{title}</p>
        <h3 className="mt-2 text-[18px] font-semibold tracking-[-0.03em] text-[var(--apex-text-primary)]">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="apex-table min-w-[760px]">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Error Rate</th>
              <th>Recorded</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((provider, index) => (
              <tr key={`${provider.provider}-${index}`}>
                <td className="font-[var(--apex-font-mono)] text-[var(--apex-text-primary)]">{provider.provider}</td>
                <td className={provider.status === "OK" ? "text-[var(--apex-status-active-text)]" : provider.status === "DEGRADED" ? "text-[var(--apex-status-watchlist-text)]" : "text-[var(--apex-status-blocked-text)]"}>
                  {provider.status}
                </td>
                <td>{provider.latencyMs != null ? `${provider.latencyMs}ms` : "—"}</td>
                <td>{provider.errorRate != null ? `${(provider.errorRate * 100).toFixed(1)}%` : "—"}</td>
                <td>{new Date(provider.recordedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
