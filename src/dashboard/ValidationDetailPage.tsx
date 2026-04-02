import Link from "next/link";

import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { DataPanel } from "@/src/dashboard/components/DataPanel";
import { MetricCard } from "@/src/dashboard/components/MetricCard";
import { StatusBadge } from "@/src/dashboard/components/StatusBadge";
import { getSystemStatusData, getValidationDetailData } from "@/src/dashboard/data";
import type { RecommendationEffectivenessVerdict } from "@/src/interfaces/contracts";

function formatDate(ts: number | null) {
  if (ts == null) {
    return "n/a";
  }

  return new Date(ts).toLocaleString();
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
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

function formatThreshold(value: number | null) {
  if (value == null) {
    return "n/a";
  }

  return value.toFixed(2);
}

function getVerdictTone(verdict: RecommendationEffectivenessVerdict): "good" | "warn" | "bad" | "neutral" {
  if (verdict === "beneficial") {
    return "good";
  }
  if (verdict === "harmful") {
    return "bad";
  }
  if (verdict === "neutral") {
    return "warn";
  }
  return "neutral";
}

function getStabilityTone(score: number): "good" | "warn" | "bad" {
  if (score >= 0.7) {
    return "good";
  }
  if (score >= 0.45) {
    return "warn";
  }
  return "bad";
}

export async function ValidationDetailPage({ runId }: { runId: string }) {
  const [detail, status] = await Promise.all([
    getValidationDetailData(runId),
    getSystemStatusData(),
  ]);
  const run = detail.run;

  return (
    <ApexShell
      title="Validation Run Detail"
      subtitle="Walk-forward comparison of observation windows versus forward windows after approved pair-profile changes, plus rolling pair stability diagnostics."
      mode={status.mode}
    >
      <div>
        <Link
          href="/validation"
          className="apex-link-button"
        >
          Back To Validation
        </Link>
      </div>

      {!run ? (
        <DataPanel title="Validation Run Missing" eyebrow="Walk-Forward Detail">
          <p className="text-sm text-[var(--apex-text-tertiary)]">The requested validation run was not found in the runtime repository.</p>
        </DataPanel>
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Run Id"
              value={run.run_id}
              detail={formatDate(run.generated_at)}
              tone="good"
            />
            <MetricCard
              label="Active FX Pairs"
              value={String(run.active_symbols.length)}
              detail={run.active_symbols.join(", ")}
            />
            <MetricCard
              label="Observation Window"
              value={formatDuration(run.observation_window_ms)}
              detail={`Forward ${formatDuration(run.forward_window_ms)}`}
            />
            <MetricCard
              label="Rolling Window"
              value={formatDuration(run.rolling_window_ms)}
              detail={`Step ${formatDuration(run.rolling_step_ms)}`}
            />
            <MetricCard
              label="Effectiveness Rows"
              value={String(run.recommendation_effectiveness.length)}
              detail={`${run.walk_forward_windows.length} rolling windows`}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <DataPanel title="Run Notes" eyebrow="Validation Context">
              <div className="space-y-3 text-sm text-[var(--apex-text-secondary)]">
                {run.notes.map(note => (
                  <p key={note}>{note}</p>
                ))}
              </div>
            </DataPanel>

            <DataPanel title="Pair Stability Ranking" eyebrow="Rolling Diagnostics">
              <div className="space-y-3">
                {run.pair_stability.map(row => (
                  <div key={row.pair} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4 text-xs text-[var(--apex-text-secondary)]">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{row.pair}</p>
                      <StatusBadge label={formatPercent(row.stability_score)} tone={getStabilityTone(row.stability_score)} />
                    </div>
                    <p className="mt-2">TP1 consistency {formatPercent(row.tp1_consistency_score)} · Calibration {formatPercent(row.confidence_calibration_stability_score)}</p>
                    <p className="mt-1 text-[var(--apex-text-tertiary)]">Veto stability {formatPercent(row.veto_reason_stability_score)} · Session consistency {formatPercent(row.session_consistency_score)}</p>
                    <div className="mt-3 space-y-1 text-[var(--apex-text-secondary)]">
                      {row.notes.map(note => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </DataPanel>
          </section>

          <DataPanel title="Rolling Walk-Forward Windows" eyebrow="Windowed Pair Metrics">
            <div className="overflow-x-auto">
              <table className="apex-table">
                <thead>
                  <tr>
                    <th className="py-2 pr-4">Pair</th>
                    <th className="py-2 pr-4">Kind</th>
                    <th className="py-2 pr-4">Window</th>
                    <th className="py-2 pr-4">Issued</th>
                    <th className="py-2 pr-4">Activated</th>
                    <th className="py-2 pr-4">Veto</th>
                    <th className="py-2 pr-4">TP1</th>
                    <th className="py-2 pr-4">Stop</th>
                    <th className="py-2">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {run.walk_forward_windows.map(window => (
                    <tr key={window.window_id}>
                      <td className="py-3 pr-4 apex-table-highlight">{window.pair}</td>
                      <td className="py-3 pr-4">{window.kind}</td>
                      <td className="py-3 pr-4">{formatDate(window.start_ts)} → {formatDate(window.end_ts)}</td>
                      <td className="py-3 pr-4">{window.metrics.signals_issued}</td>
                      <td className="py-3 pr-4">{window.metrics.signals_activated}</td>
                      <td className="py-3 pr-4">{formatPercent(window.veto_rate)}</td>
                      <td className="py-3 pr-4">{formatPercent(window.metrics.tp1_hit_rate)}</td>
                      <td className="py-3 pr-4">{formatPercent(window.metrics.stop_out_rate)}</td>
                      <td className="py-3">{formatPercent(window.metrics.expiry_rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </DataPanel>

          <section className="grid gap-4 xl:grid-cols-1">
            {run.recommendation_effectiveness.map(result => (
              <DataPanel key={result.history_id} title={result.pair} eyebrow="Recommendation Effectiveness">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{formatDate(result.applied_at)}</p>
                      <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">{result.snapshot_id}</p>
                    </div>
                    <StatusBadge label={result.verdict} tone={getVerdictTone(result.verdict)} />
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Config Diff</p>
                      <p className="mt-2">Confidence {formatThreshold(result.applied_config_diff.minConfidence.current)} → {formatThreshold(result.applied_config_diff.minConfidence.proposed)}</p>
                      <p className="mt-1">RR {formatThreshold(result.applied_config_diff.minRiskReward.current)} → {formatThreshold(result.applied_config_diff.minRiskReward.proposed)}</p>
                      <p className="mt-1">Cooldown {formatThreshold(result.applied_config_diff.cooldownMinutes.current)} → {formatThreshold(result.applied_config_diff.cooldownMinutes.proposed)}</p>
                    </div>
                    <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Pre-Change</p>
                      <p className="mt-2">Issued {result.pre_change_vs_post_change.pre_change.metrics.signals_issued}</p>
                      <p className="mt-1">TP1 {formatPercent(result.pre_change_vs_post_change.pre_change.metrics.tp1_hit_rate)}</p>
                      <p className="mt-1">Stop {formatPercent(result.pre_change_vs_post_change.pre_change.metrics.stop_out_rate)}</p>
                      <p className="mt-1">Veto {formatPercent(result.pre_change_vs_post_change.pre_change.veto_rate)}</p>
                    </div>
                    <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Forward</p>
                      <p className="mt-2">Issued {result.pre_change_vs_post_change.post_change.metrics.signals_issued}</p>
                      <p className="mt-1">TP1 {formatPercent(result.pre_change_vs_post_change.post_change.metrics.tp1_hit_rate)}</p>
                      <p className="mt-1">Stop {formatPercent(result.pre_change_vs_post_change.post_change.metrics.stop_out_rate)}</p>
                      <p className="mt-1">Veto {formatPercent(result.pre_change_vs_post_change.post_change.veto_rate)}</p>
                    </div>
                    <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Delta Summary</p>
                      <p className="mt-2">TP1 Δ {formatPercent(result.pre_change_vs_post_change.delta_summary.tp1_hit_rate_delta)}</p>
                      <p className="mt-1">Stop Δ {formatPercent(result.pre_change_vs_post_change.delta_summary.stop_out_rate_delta)}</p>
                      <p className="mt-1">Expiry Δ {formatPercent(result.pre_change_vs_post_change.delta_summary.expiry_rate_delta)}</p>
                      <p className="mt-1">Veto Δ {formatPercent(result.pre_change_vs_post_change.delta_summary.veto_rate_delta)}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">In-Sample Vs Out-Of-Sample Calibration</p>
                      <div className="mt-3 overflow-x-auto">
                        <table className="apex-table">
                          <thead>
                            <tr>
                              <th className="py-2 pr-4">Bucket</th>
                              <th className="py-2 pr-4">In TP1</th>
                              <th className="py-2 pr-4">Out TP1</th>
                              <th className="py-2 pr-4">TP1 Δ</th>
                              <th className="py-2">Stop Δ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.in_sample_vs_out_of_sample.confidence_calibration_change.map(row => (
                              <tr key={`${result.history_id}-${row.confidence_bucket}`}>
                                <td className="py-3 pr-4 apex-table-highlight">{row.confidence_bucket}</td>
                                <td className="py-3 pr-4">{formatPercent(row.in_sample_tp1_hit_rate)}</td>
                                <td className="py-3 pr-4">{formatPercent(row.out_of_sample_tp1_hit_rate)}</td>
                                <td className="py-3 pr-4">{formatPercent(row.tp1_hit_rate_delta)}</td>
                                <td className="py-3">{formatPercent(row.stop_out_rate_delta)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Session Distribution Change</p>
                      <div className="mt-3 overflow-x-auto">
                        <table className="apex-table">
                          <thead>
                            <tr>
                              <th className="py-2 pr-4">Session</th>
                              <th className="py-2 pr-4">In Issued</th>
                              <th className="py-2 pr-4">Out Issued</th>
                              <th className="py-2 pr-4">TP1 Δ</th>
                              <th className="py-2">Stop Δ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.in_sample_vs_out_of_sample.session_distribution_change.map(row => (
                              <tr key={`${result.history_id}-${row.session}`}>
                                <td className="py-3 pr-4 apex-table-highlight">{row.session}</td>
                                <td className="py-3 pr-4">{row.in_sample_signals_issued}</td>
                                <td className="py-3 pr-4">{row.out_of_sample_signals_issued}</td>
                                <td className="py-3 pr-4">{formatPercent(row.tp1_hit_rate_delta)}</td>
                                <td className="py-3">{formatPercent(row.stop_out_rate_delta)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Timing Shift</p>
                      <p className="mt-2">Activation Δ {formatDuration(result.pre_change_vs_post_change.delta_summary.average_time_to_activation_ms_delta)}</p>
                      <p className="mt-1">TP1 Δ {formatDuration(result.pre_change_vs_post_change.delta_summary.average_time_to_tp1_ms_delta)}</p>
                      <p className="mt-1">Stop Δ {formatDuration(result.pre_change_vs_post_change.delta_summary.average_time_to_stop_ms_delta)}</p>
                    </div>
                    <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Excursion Shift</p>
                      <p className="mt-2">MFE Δ {formatThreshold(result.pre_change_vs_post_change.delta_summary.average_mfe_delta)}</p>
                      <p className="mt-1">MAE Δ {formatThreshold(result.pre_change_vs_post_change.delta_summary.average_mae_delta)}</p>
                    </div>
                    <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                      <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Notes</p>
                      <div className="mt-2 space-y-1">
                        {result.notes.map(note => (
                          <p key={note}>{note}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </DataPanel>
            ))}
          </section>
        </>
      )}
    </ApexShell>
  );
}
