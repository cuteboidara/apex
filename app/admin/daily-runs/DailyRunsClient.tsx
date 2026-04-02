"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { fetchJsonResponse, formatApiError } from "@/lib/http/fetchJson";
import { getCurrentTradingSession, type TradingSession } from "@/src/config/marketScope";
import type { AdminDailyRunView } from "@/src/presentation/api/admin/dailyRuns";

type DailyRunsResponse = {
  runs: AdminDailyRunView[];
  limit: number;
};

type RetryDeliveryResponse = {
  success: boolean;
  delivery: AdminDailyRunView["deliveries"][number];
  run: AdminDailyRunView;
};

type TriggerSession = TradingSession | "all";
type TriggerDailyRunResponse = {
  success?: boolean;
  reason?: string;
  session?: TriggerSession | null;
  sessions?: TriggerSession[];
  runs?: Array<{
    id: string;
    session: TriggerSession | null;
  }>;
  error?: {
    message?: string;
  };
};

function getDefaultTriggerSession(): TriggerSession {
  return getCurrentTradingSession(Date.now());
}

function formatSession(session: AdminDailyRunView["session"]): string {
  if (!session) {
    return "Unknown";
  }

  if (session === "new_york") {
    return "New York";
  }

  return session.charAt(0).toUpperCase() + session.slice(1);
}

function formatTriggerSession(session: TriggerSession): string {
  if (session === "all") {
    return "All Sessions";
  }

  return formatSession(session);
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleString();
}

function durationLabel(start: string, end: string | null): string {
  if (!end) {
    return "—";
  }

  const started = new Date(start).getTime();
  const completed = new Date(end).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) {
    return "—";
  }

  return `${((completed - started) / 1000).toFixed(1)}s`;
}

const STATUS_STYLE: Record<string, string> = {
  completed: "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]",
  partial_failed: "text-[var(--apex-status-watchlist-text)] bg-[var(--apex-status-watchlist-bg)] border-[var(--apex-status-watchlist-border)]",
  failed: "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]",
  running: "text-[var(--apex-status-developing-text)] bg-[var(--apex-status-developing-bg)] border-[var(--apex-status-developing-border)]",
  queued: "text-[var(--apex-text-secondary)] bg-[var(--apex-status-neutral-bg)] border-[var(--apex-status-neutral-border)]",
  skipped: "text-[var(--apex-text-tertiary)] bg-[rgba(148,163,184,0.08)] border-[rgba(148,163,184,0.18)]",
  delivered: "text-[var(--apex-status-active-text)] bg-[var(--apex-status-active-bg)] border-[var(--apex-status-active-border)]",
  delivering: "text-[var(--apex-status-developing-text)] bg-[var(--apex-status-developing-bg)] border-[var(--apex-status-developing-border)]",
  failed_delivery: "text-[var(--apex-status-blocked-text)] bg-[var(--apex-status-blocked-bg)] border-[var(--apex-status-blocked-border)]",
  skipped_delivery: "text-[var(--apex-text-tertiary)] bg-[rgba(148,163,184,0.08)] border-[rgba(148,163,184,0.18)]",
};

export default function DailyRunsClient({ canTrigger }: { canTrigger: boolean }) {
  const [runs, setRuns] = useState<AdminDailyRunView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedSession, setSelectedSession] = useState<TriggerSession>(getDefaultTriggerSession);
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  async function loadRuns({ preserveLoading = false }: { preserveLoading?: boolean } = {}) {
    if (!preserveLoading) {
      setLoading(true);
    }

    const result = await fetchJsonResponse<DailyRunsResponse>("/api/admin/daily-runs?limit=50");
    if (result.ok && result.data) {
      setRuns(result.data.runs ?? []);
      setError(null);
    } else {
      setRuns([]);
      setError(formatApiError(result, "Failed to load daily signal runs."));
    }

    if (!preserveLoading) {
      setLoading(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => {
      void loadRuns();
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void loadRuns({ preserveLoading: true });
    }, 30_000);

    return () => clearInterval(interval);
  }, []);

  const summary = useMemo(() => {
    return runs.reduce(
      (acc, run) => {
        acc.total += 1;
        acc.generated += run.counts.generated;
        acc.delivered += run.counts.delivered;
        acc.failed += run.counts.failed;
        acc.zeroSignalDays += run.zeroSignalDay ? 1 : 0;
        return acc;
      },
      {
        total: 0,
        generated: 0,
        delivered: 0,
        failed: 0,
        zeroSignalDays: 0,
      },
    );
  }, [runs]);

  function toggleExpanded(runId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  }

  async function triggerDailyRun() {
    setTriggering(true);
    setTriggerResult(null);

    const triggerSession = selectedSession;
    const result = await fetchJsonResponse<TriggerDailyRunResponse>(
      "/api/jobs/daily-signals",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false, dryRun: false, session: triggerSession }),
      },
    );

    if (result.ok && result.data?.success) {
      const sessions = Array.isArray(result.data.runs)
        ? result.data.runs
          .map(item => item.session)
          .filter((value): value is TriggerSession => Boolean(value))
        : (Array.isArray(result.data.sessions)
          ? result.data.sessions.filter((value): value is TriggerSession => Boolean(value))
          : []);
      const sessionLabel = sessions.length > 0
        ? sessions.map(formatTriggerSession).join(", ")
        : formatTriggerSession(triggerSession);
      setTriggerResult(`Run request accepted for ${sessionLabel} (${result.data.reason ?? "ok"})`);
      await loadRuns({ preserveLoading: true });
    } else {
      setTriggerResult(formatApiError(result, "Daily run trigger failed."));
    }

    setTriggering(false);
  }

  async function retryDelivery(runId: string, deliveryId: string) {
    setRetrying(deliveryId);

    const result = await fetchJsonResponse<RetryDeliveryResponse>(`/api/admin/daily-runs/${runId}/retry-delivery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliveryId }),
    });

    if (result.ok && result.data?.success) {
      setRuns(prev => prev.map(run => run.id === runId ? result.data!.run : run));
      setError(null);
    } else {
      setError(formatApiError(result, "Daily delivery retry failed."));
    }

    setRetrying(null);
  }

  return (
    <div className="space-y-6">
      <section className="apex-surface px-6 py-6">
        <div className="apex-toolbar gap-4">
          <div>
            <p className="apex-eyebrow">Daily Signal Orchestration</p>
            <h2 className="mt-3 font-[var(--apex-font-display)] text-[28px] font-semibold tracking-[-0.05em] text-[var(--apex-text-primary)]">
              Stored runs and delivery outcomes
            </h2>
            <p className="mt-3 max-w-[820px] text-[14px] leading-7 text-[var(--apex-text-secondary)]">
              Canonical persisted truth for scheduled runs, zero-signal days, and per-channel delivery status.
            </p>
          </div>
          {canTrigger ? (
            <div className="flex flex-col items-start gap-3">
              <div className="apex-tab-row">
                {(["asia", "london", "new_york", "all"] as TriggerSession[]).map(session => (
                  <button
                    key={session}
                    type="button"
                    data-active={selectedSession === session}
                    onClick={() => setSelectedSession(session)}
                    className="apex-tab-button"
                  >
                    {formatTriggerSession(session)}
                  </button>
                ))}
              </div>
              <button
                onClick={() => void triggerDailyRun()}
                disabled={triggering}
                className="apex-button apex-button-amber disabled:opacity-50"
              >
                {triggering ? "Triggering" : `Trigger ${formatTriggerSession(selectedSession)}`}
              </button>
            </div>
          ) : null}
        </div>
        {canTrigger ? (
          <p className="mt-4 text-[12px] text-[var(--apex-text-tertiary)]">
            Manual trigger targets the selected session only. Choose <span className="text-[var(--apex-text-primary)]">All Sessions</span> to run Asia, London, and New York in one request.
          </p>
        ) : null}
        {triggerResult ? (
          <div className="mt-5 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-default)] bg-[rgba(255,255,255,0.03)] px-4 py-3 text-sm text-[var(--apex-text-secondary)]">
            {triggerResult}
          </div>
        ) : null}
      </section>

      <div className="apex-admin-kpi-grid">
        <StatCard label="Runs" value={summary.total} />
        <StatCard label="Signals" value={summary.generated} />
        <StatCard label="Delivered" value={summary.delivered} />
        <StatCard label="Failed" value={summary.failed} />
        <StatCard label="Zero Signal Days" value={summary.zeroSignalDays} />
      </div>

      {loading ? (
        <div className="apex-empty-state">Loading daily run history…</div>
      ) : error ? (
        <div className="apex-stack-card border-[var(--apex-status-blocked-border)] bg-[var(--apex-status-blocked-bg)] text-sm text-[var(--apex-status-blocked-text)]">
          {error}
        </div>
      ) : (
        <div className="apex-table-shell overflow-hidden">
          <div className="overflow-x-auto px-6 py-5">
            <table className="apex-table min-w-[1180px]">
              <thead>
                <tr>
                  <th>Window</th>
                  <th>Status</th>
                  <th>Signals</th>
                  <th>Deliveries</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Duration</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="apex-empty-state">
                      No daily runs found.
                    </td>
                  </tr>
                ) : (
                  runs.map(run => (
                    <Fragment key={run.id}>
                      <tr>
                        <td className="font-[var(--apex-font-body)] text-[var(--apex-text-primary)]">
                          <p className="font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-primary)]">{run.baseWindowKey}</p>
                          <p className="mt-1 text-[11px] text-[var(--apex-text-tertiary)]">{formatSession(run.session)} · {run.triggerSource} · {run.scheduledTime} {run.timezone}</p>
                        </td>
                        <td>
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${STATUS_STYLE[run.status] ?? "text-[var(--apex-text-secondary)] border-[var(--apex-border-default)]"}`}>
                            {run.status}
                          </span>
                          {run.zeroSignalDay ? <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Zero signal day</p> : null}
                        </td>
                        <td>
                          <div className="space-y-1 text-[12px]">
                            <p>Generated: {run.counts.generated}</p>
                            <p>Published: {run.counts.published}</p>
                          </div>
                        </td>
                        <td>
                          <div className="space-y-1 text-[12px]">
                            <p>Delivered: {run.counts.delivered}</p>
                            <p>Failed: {run.counts.failed}</p>
                          </div>
                        </td>
                        <td>{formatDateTime(run.createdAt)}</td>
                        <td>{formatDateTime(run.completedAt)}</td>
                        <td>{durationLabel(run.createdAt, run.completedAt)}</td>
                        <td className="pr-0 text-right">
                          <button onClick={() => toggleExpanded(run.id)} className="apex-link-button px-3 py-2 text-[10px]">
                            {expanded.has(run.id) ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {expanded.has(run.id) ? (
                        <tr>
                          <td colSpan={8} className="pr-0">
                            <div className="grid gap-5 rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5 lg:grid-cols-[1fr_1.25fr]">
                              <div className="space-y-4">
                                <div>
                                  <p className="apex-eyebrow">Run Detail</p>
                                  <div className="mt-3 space-y-2 text-[12px] text-[var(--apex-text-secondary)]">
                                    <p>Triggered by: <span className="text-[var(--apex-text-primary)]">{run.triggeredBy}</span></p>
                                    <p>Forced: <span className="text-[var(--apex-text-primary)]">{run.forced ? "yes" : "no"}</span></p>
                                    <p>Dry run: <span className="text-[var(--apex-text-primary)]">{run.dryRun ? "yes" : "no"}</span></p>
                                    <p>Error: <span className="text-[var(--apex-text-primary)]">{run.errorMessage ?? "—"}</span></p>
                                  </div>
                                </div>

                                <div>
                                  <p className="apex-eyebrow">Payload Summary</p>
                                  {run.signalPayloadSummary ? (
                                    <div className="mt-3 space-y-2 text-[12px] text-[var(--apex-text-secondary)]">
                                      <p>Min grade: <span className="text-[var(--apex-text-primary)]">{run.signalPayloadSummary.minimumGrade ?? "—"}</span></p>
                                      <p>All cards: <span className="text-[var(--apex-text-primary)]">{run.signalPayloadSummary.allCardsCount}</span></p>
                                      <p>Publishable: <span className="text-[var(--apex-text-primary)]">{run.signalPayloadSummary.publishableCardsCount}</span></p>
                                      <p>Commentary: <span className="text-[var(--apex-text-primary)]">{run.signalPayloadSummary.hasMarketCommentary ? "yes" : "no"}</span></p>
                                    </div>
                                  ) : (
                                    <p className="mt-3 text-[12px] text-[var(--apex-text-tertiary)]">No payload stored.</p>
                                  )}
                                </div>
                              </div>

                              <div>
                                <p className="apex-eyebrow">Deliveries</p>
                                {run.deliveries.length === 0 ? (
                                  <p className="mt-3 text-[12px] text-[var(--apex-text-tertiary)]">No deliveries recorded.</p>
                                ) : (
                                  <div className="overflow-x-auto">
                                    <table className="apex-table min-w-[720px]">
                                      <thead>
                                        <tr>
                                          <th>Channel</th>
                                          <th>Target</th>
                                          <th>Status</th>
                                          <th>Attempts</th>
                                          <th>Last Attempt</th>
                                          <th>Error</th>
                                          <th />
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {run.deliveries.map(delivery => (
                                          <tr key={delivery.id}>
                                            <td className="text-[var(--apex-text-primary)]">{delivery.channel}</td>
                                            <td>{delivery.target}</td>
                                            <td>
                                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.12em] ${
                                                delivery.status === "failed"
                                                  ? STATUS_STYLE.failed_delivery
                                                  : delivery.status === "skipped"
                                                    ? STATUS_STYLE.skipped_delivery
                                                    : STATUS_STYLE[delivery.status] ?? "text-[var(--apex-text-secondary)] border-[var(--apex-border-default)]"
                                              }`}>
                                                {delivery.status}
                                              </span>
                                            </td>
                                            <td>{delivery.attempts}</td>
                                            <td>{formatDateTime(delivery.lastAttemptAt)}</td>
                                            <td className="text-[var(--apex-status-blocked-text)]">{delivery.errorMessage ?? "—"}</td>
                                            <td className="pr-0 text-right">
                                              <button
                                                onClick={() => void retryDelivery(run.id, delivery.id)}
                                                disabled={retrying === delivery.id}
                                                className="apex-link-button px-3 py-2 text-[10px] disabled:opacity-40"
                                              >
                                                {retrying === delivery.id ? "Retrying" : "Retry Delivery"}
                                              </button>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="apex-admin-kpi">
      <p className="apex-admin-kpi-label">{label}</p>
      <p className="apex-admin-kpi-value">{value}</p>
    </div>
  );
}
