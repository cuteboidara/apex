import Link from "next/link";

import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { DataPanel } from "@/src/dashboard/components/DataPanel";
import { MetricCard } from "@/src/dashboard/components/MetricCard";
import { RecommendationGenerateButton } from "@/src/dashboard/components/RecommendationGenerateButton";
import { StatusBadge } from "@/src/dashboard/components/StatusBadge";
import { getRecommendationsPageData, getSystemStatusData } from "@/src/dashboard/data";
import type { RecommendationApprovalStatus } from "@/src/interfaces/contracts";

function formatDate(ts: number | null) {
  if (ts == null) {
    return "n/a";
  }

  return new Date(ts).toLocaleString();
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatThreshold(value: number) {
  return value.toFixed(2);
}

function formatSessions(values: string[]) {
  return values.length > 0 ? values.join(", ") : "none";
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

function countProposals(proposalStatuses: RecommendationApprovalStatus[], target: RecommendationApprovalStatus) {
  return proposalStatuses.filter(status => status === target).length;
}

export async function RecommendationsPage() {
  const [queue, status] = await Promise.all([
    getRecommendationsPageData(),
    getSystemStatusData(),
  ]);
  const latest = queue.latest_snapshot;
  const latestProposalStatuses = latest?.proposals.map(proposal => proposal.approval_status) ?? [];

  return (
    <ApexShell
      title="Recommendation Queue"
      subtitle="Versioned pair-profile tuning proposals derived from the FX calibration layer. Proposals stay reviewable until an operator explicitly approves or rejects them."
      mode={status.mode}
    >
      <section className="flex justify-end">
        <RecommendationGenerateButton />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Active FX Pairs"
          value={String(queue.active_symbols.length)}
          detail={queue.active_symbols.join(", ") || "No active pairs"}
        />
        <MetricCard
          label="Latest Snapshot"
          value={latest ? `v${latest.version}` : "none"}
          detail={latest ? formatDate(latest.created_at) : "Generate a review set"}
          tone={latest ? getStatusTone(latest.approval_status) : "neutral"}
        />
        <MetricCard
          label="Open Proposals"
          value={String(countProposals(latestProposalStatuses, "proposed"))}
          detail={latest ? latest.primary_entry_style.replaceAll("_", " ") : "No snapshot yet"}
          tone={latestProposalStatuses.includes("proposed") ? "warn" : "neutral"}
        />
        <MetricCard
          label="Approved"
          value={String(latestProposalStatuses.filter(statusCode => statusCode === "approved").length)}
          detail="Latest snapshot approvals"
          tone={latestProposalStatuses.includes("approved") ? "good" : "neutral"}
        />
        <MetricCard
          label="Applied History"
          value={String(queue.applied_history.length)}
          detail={queue.applied_history[0] ? `${queue.applied_history[0].pair} at ${formatDate(queue.applied_history[0].applied_at)}` : "No applied changes"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <DataPanel title="Current Pair Profiles" eyebrow="Active Runtime Config">
          <div className="overflow-x-auto">
            <table className="apex-table">
              <thead>
                <tr>
                  <th className="py-2 pr-4">Pair</th>
                  <th className="py-2 pr-4">Min Conf</th>
                  <th className="py-2 pr-4">Min RR</th>
                  <th className="py-2 pr-4">Allowed</th>
                  <th className="py-2 pr-4">Preferred</th>
                  <th className="py-2 pr-4">Avoid</th>
                  <th className="py-2 pr-4">Cooldown</th>
                  <th className="py-2">ATR Tol</th>
                </tr>
              </thead>
              <tbody>
                {queue.current_profiles.map(profile => (
                  <tr key={profile.pair}>
                    <td className="py-3 pr-4 apex-table-highlight">{profile.pair}</td>
                    <td className="py-3 pr-4">{formatThreshold(profile.minConfidence)}</td>
                    <td className="py-3 pr-4">{formatThreshold(profile.minRiskReward)}</td>
                    <td className="py-3 pr-4">{formatSessions(profile.allowedSessions)}</td>
                    <td className="py-3 pr-4">{formatSessions(profile.preferredSessions)}</td>
                    <td className="py-3 pr-4">{formatSessions(profile.avoidSessions)}</td>
                    <td className="py-3 pr-4">{profile.cooldownMinutes}m</td>
                    <td className="py-3">{formatThreshold(profile.atrToleranceMultiplier)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataPanel>

        <DataPanel title="Latest Snapshot" eyebrow="Current Review Set">
          {latest ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">Snapshot v{latest.version}</p>
                <StatusBadge label={latest.approval_status} tone={getStatusTone(latest.approval_status)} />
              </div>
              <div className="grid gap-2 font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--apex-text-tertiary)]">Created</span>
                  <span>{formatDate(latest.created_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--apex-text-tertiary)]">Analytics Snapshot</span>
                  <span>{formatDate(latest.analytics_generated_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--apex-text-tertiary)]">Active Pairs</span>
                  <span>{latest.active_symbols.join(", ")}</span>
                </div>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                  <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Proposal Status</p>
                  <p className="mt-2">Proposed {countProposals(latestProposalStatuses, "proposed")}</p>
                  <p className="mt-1">Approved {latestProposalStatuses.filter(statusCode => statusCode === "approved").length}</p>
                  <p className="mt-1">Rejected {latestProposalStatuses.filter(statusCode => statusCode === "rejected").length}</p>
                </div>
                <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                  <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Review Link</p>
                  <Link
                    href={`/recommendations/${latest.snapshot_id}`}
                    className="apex-link-button mt-2"
                  >
                    Open Detail
                  </Link>
                </div>
              </div>
              <div className="space-y-2 text-xs text-[var(--apex-text-secondary)]">
                {latest.notes.map(note => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--apex-text-tertiary)]">No recommendation snapshot has been generated yet.</p>
          )}
        </DataPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <DataPanel title="Snapshot Queue" eyebrow="Versioned Recommendation Sets">
          <div className="space-y-3">
            {queue.snapshots.map(snapshot => {
              const proposalStatuses = snapshot.proposals.map(proposal => proposal.approval_status);
              return (
                <div key={snapshot.snapshot_id} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">v{snapshot.version}</p>
                      <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">{formatDate(snapshot.created_at)}</p>
                    </div>
                    <StatusBadge label={snapshot.approval_status} tone={getStatusTone(snapshot.approval_status)} />
                  </div>
                  <p className="mt-3 text-xs text-[var(--apex-text-secondary)]">
                    Proposed {proposalStatuses.filter(statusCode => statusCode === "proposed").length}
                    {" · "}
                    Approved {proposalStatuses.filter(statusCode => statusCode === "approved").length}
                    {" · "}
                    Rejected {proposalStatuses.filter(statusCode => statusCode === "rejected").length}
                  </p>
                  <p className="mt-2 text-xs text-[var(--apex-text-tertiary)]">{snapshot.active_symbols.join(", ")}</p>
                  <div className="mt-4">
                    <Link
                      href={`/recommendations/${snapshot.snapshot_id}`}
                      className="apex-link-button"
                    >
                      View Proposal Detail
                    </Link>
                  </div>
                </div>
              );
            })}
            {queue.snapshots.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No snapshots recorded yet.</p> : null}
          </div>
        </DataPanel>

        <DataPanel title="Applied History" eyebrow="Approved Runtime Mutations">
          <div className="space-y-3">
            {queue.applied_history.map(entry => (
              <div key={entry.history_id} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4 text-xs text-[var(--apex-text-secondary)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{entry.pair}</p>
                  <StatusBadge label={entry.approval_status} tone="good" />
                </div>
                <p className="mt-2 text-[var(--apex-text-tertiary)]">{formatDate(entry.applied_at)} • snapshot {entry.snapshot_id}</p>
                <p className="mt-2">
                  Confidence {formatThreshold(entry.applied_profile.minConfidence)} • RR {formatThreshold(entry.applied_profile.minRiskReward)} • Cooldown {entry.applied_profile.cooldownMinutes}m
                </p>
                <p className="mt-1 text-[var(--apex-text-tertiary)]">
                  Before TP1 {formatPercent(entry.performance_comparison.overall_before.tp1_hit_rate)}
                  {" · "}
                  After TP1 {formatPercent(entry.performance_comparison.overall_after.tp1_hit_rate)}
                </p>
              </div>
            ))}
            {queue.applied_history.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No approved recommendation history yet.</p> : null}
          </div>
        </DataPanel>
      </section>
    </ApexShell>
  );
}
