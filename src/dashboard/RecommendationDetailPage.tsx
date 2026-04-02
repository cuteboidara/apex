import Link from "next/link";

import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { DataPanel } from "@/src/dashboard/components/DataPanel";
import { MetricCard } from "@/src/dashboard/components/MetricCard";
import { RecommendationReviewButton } from "@/src/dashboard/components/RecommendationReviewButton";
import { StatusBadge } from "@/src/dashboard/components/StatusBadge";
import { getRecommendationDetailData, getSystemStatusData } from "@/src/dashboard/data";
import type { ProposedConfigDiff, RecommendationApprovalStatus } from "@/src/interfaces/contracts";

function formatDate(ts: number | null) {
  if (ts == null) {
    return "n/a";
  }

  return new Date(ts).toLocaleString();
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatThreshold(value: number | null) {
  if (value == null) {
    return "n/a";
  }

  return value.toFixed(2);
}

function formatDuration(value: number | null) {
  if (value == null) {
    return "n/a";
  }

  const minutes = value / 60_000;
  if (minutes < 1) {
    return `${Math.round(value / 1000)}s`;
  }
  if (minutes < 60) {
    return `${minutes.toFixed(1)}m`;
  }
  return `${(minutes / 60).toFixed(1)}h`;
}

function formatDiffValue(value: number | string[] | null) {
  if (value == null) {
    return "n/a";
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "none";
  }
  return typeof value === "number" ? value.toFixed(2) : String(value);
}

function getStatusTone(status: RecommendationApprovalStatus): "good" | "warn" | "bad" | "neutral" {
  if (status === "approved") {
    return "good";
  }
  if (status === "proposed") {
    return "warn";
  }
  if (status === "rejected") {
    return "bad";
  }
  return "neutral";
}

function getDiffRows(diff: ProposedConfigDiff) {
  return [
    { label: "Min Confidence", field: diff.minConfidence },
    { label: "Min RR", field: diff.minRiskReward },
    { label: "Allowed Sessions", field: diff.allowedSessions },
    { label: "Preferred Sessions", field: diff.preferredSessions },
    { label: "Avoid Sessions", field: diff.avoidSessions },
    { label: "Max Signals Per Day", field: diff.maxSignalsPerDay },
    { label: "Cooldown Minutes", field: diff.cooldownMinutes },
    { label: "ATR Tolerance", field: diff.atrToleranceMultiplier },
  ];
}

export async function RecommendationDetailPage({ snapshotId }: { snapshotId: string }) {
  const [detail, status] = await Promise.all([
    getRecommendationDetailData(snapshotId),
    getSystemStatusData(),
  ]);
  const snapshot = detail.snapshot;

  return (
    <ApexShell
      title="Recommendation Detail"
      subtitle="Review current-versus-proposed pair-profile changes, approve or reject them explicitly, and track applied outcomes against the original calibration snapshot."
      mode={status.mode}
    >
      <div>
        <Link
          href="/recommendations"
          className="apex-link-button"
        >
          Back To Queue
        </Link>
      </div>

      {!snapshot ? (
        <DataPanel title="Snapshot Missing" eyebrow="Recommendation Detail">
          <p className="text-sm text-[var(--apex-text-tertiary)]">The requested recommendation snapshot was not found in the runtime repository.</p>
        </DataPanel>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Snapshot Version"
              value={`v${snapshot.version}`}
              detail={formatDate(snapshot.created_at)}
              tone={getStatusTone(snapshot.approval_status)}
            />
            <MetricCard
              label="Approval State"
              value={snapshot.approval_status}
              detail={snapshot.primary_entry_style.replaceAll("_", " ")}
              tone={getStatusTone(snapshot.approval_status)}
            />
            <MetricCard
              label="Pairs"
              value={String(snapshot.active_symbols.length)}
              detail={snapshot.active_symbols.join(", ")}
            />
            <MetricCard
              label="Open Reviews"
              value={String(snapshot.proposals.filter(proposal => proposal.approval_status === "proposed").length)}
              detail="Operator action required"
              tone={snapshot.proposals.some(proposal => proposal.approval_status === "proposed") ? "warn" : "neutral"}
            />
            <MetricCard
              label="Applied History"
              value={String(detail.applied_history.length)}
              detail={detail.applied_history[0] ? `${detail.applied_history[0].pair} latest` : "No applied entries"}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
            <DataPanel title="Snapshot Notes" eyebrow="Governed Review Set">
              <div className="space-y-3 text-sm text-[var(--apex-text-secondary)]">
                {snapshot.notes.map(note => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </DataPanel>

            <DataPanel title="Current Runtime Profiles" eyebrow="Live Baseline">
              <div className="space-y-3">
                {detail.current_profiles.map(profile => (
                  <div key={profile.pair} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4 text-xs text-[var(--apex-text-secondary)]">
                    <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{profile.pair}</p>
                    <p className="mt-2">Confidence {formatThreshold(profile.minConfidence)} • RR {formatThreshold(profile.minRiskReward)} • Cooldown {profile.cooldownMinutes}m</p>
                    <p className="mt-1 text-[var(--apex-text-tertiary)]">Allowed {profile.allowedSessions.join(", ") || "none"} • Avoid {profile.avoidSessions.join(", ") || "none"}</p>
                  </div>
                ))}
              </div>
            </DataPanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-2">
            {snapshot.proposals.map(proposal => {
              const liveDiff = detail.live_diffs[proposal.pair] ?? proposal.proposed_config_diff;
              return (
                <DataPanel key={proposal.proposal_id} title={proposal.pair} eyebrow="Pair Proposal">
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <StatusBadge label={proposal.approval_status} tone={getStatusTone(proposal.approval_status)} />
                      <p className="font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-tertiary)]">{formatDate(proposal.analytics_generated_at)}</p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                        <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Observed Metrics</p>
                        <p className="mt-2">Issued {proposal.observed_metrics.signals_issued} • Activated {proposal.observed_metrics.signals_activated}</p>
                        <p className="mt-1">TP1 {formatPercent(proposal.observed_metrics.tp1_hit_rate)} • Stop {formatPercent(proposal.observed_metrics.stop_out_rate)} • Expiry {formatPercent(proposal.observed_metrics.expiry_rate)}</p>
                        <p className="mt-1 text-[var(--apex-text-tertiary)]">Activation {formatDuration(proposal.observed_metrics.average_time_to_activation_ms)}</p>
                        <p className="mt-1 text-[var(--apex-text-tertiary)]">Dominant veto {proposal.observed_metrics.dominant_veto_reason ?? "none"}</p>
                      </div>
                      <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                        <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Rationale</p>
                        <div className="mt-2 space-y-1">
                          {proposal.rationale.map(line => (
                            <p key={line}>{line}</p>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Current Vs Proposed Config</p>
                      <div className="mt-3 overflow-x-auto">
                        <table className="apex-table">
                          <thead>
                            <tr>
                              <th className="py-2 pr-4">Field</th>
                              <th className="py-2 pr-4">Current</th>
                              <th className="py-2 pr-4">Proposed</th>
                              <th className="py-2">Changed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {getDiffRows(liveDiff).map(row => (
                              <tr key={`${proposal.proposal_id}-${row.label}`}>
                                <td className="py-3 pr-4 apex-table-highlight">{row.label}</td>
                                <td className="py-3 pr-4">{formatDiffValue(row.field.current)}</td>
                                <td className="py-3 pr-4">{formatDiffValue(row.field.proposed)}</td>
                                <td className="py-3">{row.field.changed ? "yes" : "no"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs text-[var(--apex-text-secondary)]">
                      {proposal.notes.map(note => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>

                    {proposal.approval_status === "proposed" ? (
                      <div className="flex flex-wrap gap-2">
                        <RecommendationReviewButton snapshotId={snapshot.snapshot_id} pair={proposal.pair} action="approve" />
                        <RecommendationReviewButton snapshotId={snapshot.snapshot_id} pair={proposal.pair} action="reject" />
                      </div>
                    ) : null}
                  </div>
                </DataPanel>
              );
            })}
          </section>

          <DataPanel title="Applied History And Before/After Results" eyebrow="Traceable Runtime Changes">
            <div className="space-y-4">
              {detail.applied_history.map(entry => (
                <div key={entry.history_id} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{entry.pair}</p>
                      <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">{formatDate(entry.applied_at)} • {entry.snapshot_id}</p>
                    </div>
                    <StatusBadge label={entry.approval_status} tone="good" />
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Overall Before / After</p>
                      <p className="mt-2">TP1 {formatPercent(entry.performance_comparison.overall_before.tp1_hit_rate)} → {formatPercent(entry.performance_comparison.overall_after.tp1_hit_rate)}</p>
                      <p className="mt-1">Stop {formatPercent(entry.performance_comparison.overall_before.stop_out_rate)} → {formatPercent(entry.performance_comparison.overall_after.stop_out_rate)}</p>
                      <p className="mt-1">Expiry {formatPercent(entry.performance_comparison.overall_before.expiry_rate)} → {formatPercent(entry.performance_comparison.overall_after.expiry_rate)}</p>
                    </div>
                    <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Config Applied</p>
                      <p className="mt-2">Confidence {formatThreshold(entry.applied_profile.minConfidence)} • RR {formatThreshold(entry.applied_profile.minRiskReward)}</p>
                      <p className="mt-1">Preferred {entry.applied_profile.preferredSessions.join(", ") || "none"}</p>
                      <p className="mt-1">Avoid {entry.applied_profile.avoidSessions.join(", ") || "none"}</p>
                    </div>
                  </div>
                  <div className="mt-4 overflow-x-auto">
                    <table className="apex-table">
                      <thead>
                        <tr>
                          <th className="py-2 pr-4">Session</th>
                          <th className="py-2 pr-4">Before TP1</th>
                          <th className="py-2 pr-4">After TP1</th>
                          <th className="py-2 pr-4">Before Stop</th>
                          <th className="py-2 pr-4">After Stop</th>
                          <th className="py-2">After Issued</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entry.performance_comparison.by_session.map(sessionRow => (
                          <tr key={`${entry.history_id}-${sessionRow.session}`}>
                            <td className="py-3 pr-4 apex-table-highlight">{sessionRow.session}</td>
                            <td className="py-3 pr-4">{formatPercent(sessionRow.before.tp1_hit_rate)}</td>
                            <td className="py-3 pr-4">{formatPercent(sessionRow.after.tp1_hit_rate)}</td>
                            <td className="py-3 pr-4">{formatPercent(sessionRow.before.stop_out_rate)}</td>
                            <td className="py-3 pr-4">{formatPercent(sessionRow.after.stop_out_rate)}</td>
                            <td className="py-3">{sessionRow.after.signals_issued}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              {detail.applied_history.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No applied history is linked to this snapshot yet.</p> : null}
            </div>
          </DataPanel>
        </>
      )}
    </ApexShell>
  );
}
