import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { DataPanel } from "@/src/dashboard/components/DataPanel";
import { MetricCard } from "@/src/dashboard/components/MetricCard";
import { getQualityPageData, getSystemStatusData } from "@/src/dashboard/data";

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatAverage(value: number | null) {
  if (value == null) {
    return "n/a";
  }

  return value.toFixed(4);
}

function formatThreshold(value: number) {
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

function formatSessions(values: string[]) {
  return values.length > 0 ? values.join(", ") : "none";
}

function formatEntryStyles(values: string[]) {
  return values.length > 0 ? values.map(value => value.replaceAll("_", " ")).join(" • ") : "No styles enabled";
}

export async function QualityPage() {
  const [quality, status] = await Promise.all([
    getQualityPageData(),
    getSystemStatusData(),
  ]);

  return (
    <ApexShell
      title="Signal Quality And Calibration"
      subtitle="FX intraday quality analytics and operator-facing tuning guidance derived from the decision journal, veto taxonomy, and the latest signal lifecycle state."
      mode={status.mode}
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard
          label="Active Universe"
          value={String(quality.active_symbols.length)}
          detail={quality.active_symbols.join(", ") || "No active FX pairs"}
        />
        <MetricCard
          label="Signals Issued"
          value={String(quality.totals.signals_issued)}
          detail={formatEntryStyles(quality.enabled_entry_styles)}
        />
        <MetricCard
          label="Signals Activated"
          value={String(quality.totals.signals_activated)}
          detail={quality.totals.signals_issued === 0 ? "No issued signals yet" : formatPercent(quality.totals.signals_activated / quality.totals.signals_issued)}
          tone={quality.totals.signals_activated > 0 ? "good" : "neutral"}
        />
        <MetricCard
          label="Vetoed Signals"
          value={String(quality.totals.veto_count)}
          detail={quality.veto_effectiveness[0]?.reason ?? "No veto reasons"}
          tone={quality.totals.veto_count > 0 ? "warn" : "good"}
        />
        <MetricCard
          label="Time To Activation"
          value={formatDuration(quality.totals.average_time_to_activation_ms)}
          detail={`TP1 ${formatDuration(quality.totals.average_time_to_tp1_ms)}`}
        />
        <MetricCard
          label="Failure Profile"
          value={`SL ${formatPercent(quality.totals.stop_out_rate)}`}
          detail={`Exp ${formatPercent(quality.totals.expiry_rate)} • Canc ${formatPercent(quality.totals.cancellation_rate)}`}
          tone={quality.totals.stop_out_rate >= 0.5 ? "bad" : quality.totals.stop_out_rate > 0 ? "warn" : "good"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <DataPanel title="Confidence Calibration" eyebrow="Bucketed Outcome Diagnostics">
          <div className="overflow-x-auto">
            <table className="apex-table">
              <thead>
                <tr>
                  <th className="py-2 pr-4">Bucket</th>
                  <th className="py-2 pr-4">Issued</th>
                  <th className="py-2 pr-4">Activated</th>
                  <th className="py-2 pr-4">Vetoed</th>
                  <th className="py-2 pr-4">TP1</th>
                  <th className="py-2 pr-4">TP2</th>
                  <th className="py-2 pr-4">TP3</th>
                  <th className="py-2 pr-4">Stop</th>
                  <th className="py-2 pr-4">Expiry</th>
                  <th className="py-2 pr-4">Act Time</th>
                  <th className="py-2 pr-4">TP1 Time</th>
                  <th className="py-2 pr-4">Stop Time</th>
                  <th className="py-2 pr-4">MFE</th>
                  <th className="py-2">MAE</th>
                </tr>
              </thead>
              <tbody>
                {quality.confidence_calibration.map(row => (
                  <tr key={row.confidence_bucket}>
                    <td className="py-3 pr-4 apex-table-highlight">{row.confidence_bucket}</td>
                    <td className="py-3 pr-4">{row.signals_issued}</td>
                    <td className="py-3 pr-4">{row.signals_activated}</td>
                    <td className="py-3 pr-4">{row.signals_vetoed}</td>
                    <td className="py-3 pr-4">{formatPercent(row.tp1_hit_rate)}</td>
                    <td className="py-3 pr-4">{formatPercent(row.tp2_hit_rate)}</td>
                    <td className="py-3 pr-4">{formatPercent(row.tp3_hit_rate)}</td>
                    <td className="py-3 pr-4">{formatPercent(row.stop_out_rate)}</td>
                    <td className="py-3 pr-4">{formatPercent(row.expiry_rate)}</td>
                    <td className="py-3 pr-4">{formatDuration(row.average_time_to_activation_ms)}</td>
                    <td className="py-3 pr-4">{formatDuration(row.average_time_to_tp1_ms)}</td>
                    <td className="py-3 pr-4">{formatDuration(row.average_time_to_stop_ms)}</td>
                    <td className="py-3 pr-4">{formatAverage(row.average_mfe)}</td>
                    <td className="py-3">{formatAverage(row.average_mae)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataPanel>

        <DataPanel title="Timing Snapshot" eyebrow="Signal Creation To Outcome">
          <div className="space-y-3">
            {quality.signal_timing_diagnostics.slice(0, 6).map(row => (
              <div key={`${row.pair}-${row.session}`} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4 text-xs text-[var(--apex-text-secondary)]">
                <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{row.pair} • {row.session}</p>
                <p className="mt-2">Activation {formatPercent(row.activation_rate)} • Exp-before-act {formatPercent(row.expiry_before_activation_rate)}</p>
                <p className="mt-1 text-[var(--apex-text-tertiary)]">Created → activated {formatDuration(row.average_time_to_activation_ms)}</p>
                <p className="mt-1 text-[var(--apex-text-tertiary)]">Activated → TP1 {formatDuration(row.average_time_from_activated_to_tp1_ms)}</p>
                <p className="mt-1 text-[var(--apex-text-tertiary)]">Activated → stop {formatDuration(row.average_time_from_activated_to_stop_ms)}</p>
              </div>
            ))}
            {quality.signal_timing_diagnostics.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No timing diagnostics yet.</p> : null}
          </div>
        </DataPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <DataPanel title="Pair Tuning Recommendations" eyebrow="Configuration Guidance">
          <div className="grid gap-3 lg:grid-cols-2">
            {quality.pair_tuning_recommendations.map(row => (
              <div key={row.pair} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{row.pair}</p>
                    <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">{row.sample_size} observed signals</p>
                  </div>
                  <p className="font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)]">Cooldown {row.cooldown_recommendation_minutes}m</p>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                    <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Thresholds</p>
                    <p className="mt-2">Min confidence {formatThreshold(row.suggested_minimum_confidence_threshold)}</p>
                    <p className="mt-1">Min RR {formatThreshold(row.suggested_minimum_rr_threshold)}</p>
                    <p className="mt-1 text-[var(--apex-text-tertiary)]">Activation {formatPercent(row.activation_rate)}</p>
                  </div>
                  <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                    <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Observed Outcomes</p>
                    <p className="mt-2">TP1 {formatPercent(row.tp1_hit_rate)}</p>
                    <p className="mt-1">Stop {formatPercent(row.stop_out_rate)}</p>
                    <p className="mt-1">Expiry {formatPercent(row.expiry_rate)}</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                    <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Preferred Sessions</p>
                    <p className="mt-2">{formatSessions(row.preferred_sessions)}</p>
                  </div>
                  <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                    <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Avoid Sessions</p>
                    <p className="mt-2">{formatSessions(row.sessions_to_avoid)}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2 text-xs text-[var(--apex-text-secondary)]">
                  {row.notes.map(note => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DataPanel>

        <DataPanel title="Veto Diagnostics" eyebrow="Reason, Slice, And Confidence">
          <div className="space-y-3">
            {quality.veto_effectiveness.map(row => (
              <div key={row.reason} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{row.reason}</p>
                  <p className="font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)]">{row.count} • {formatPercent(row.percentage_of_total_vetoes)}</p>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                    <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Pair / Session / Regime</p>
                    <div className="mt-2 space-y-1">
                      {row.associated_slices.slice(0, 3).map(slice => (
                        <p key={`${row.reason}-${slice.pair}-${slice.session}-${slice.regime}`}>
                          {slice.pair} • {slice.session} • {slice.regime} • {slice.count} ({formatPercent(slice.percentage_of_reason_vetoes)})
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-surface)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                    <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--apex-text-tertiary)]">Confidence Distribution</p>
                    <div className="mt-2 space-y-1">
                      {row.confidence_distribution.map(bucket => (
                        <p key={`${row.reason}-${bucket.confidence_bucket}`}>
                          {bucket.confidence_bucket} • {bucket.count} ({formatPercent(bucket.percentage_of_reason_vetoes)})
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {quality.veto_effectiveness.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No veto diagnostics recorded for the active FX scope.</p> : null}
          </div>
        </DataPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <DataPanel title="Timing Diagnostics" eyebrow="Per Pair And Session">
          <div className="overflow-x-auto">
            <table className="apex-table">
              <thead>
                <tr>
                  <th className="py-2 pr-4">Pair / Session</th>
                  <th className="py-2 pr-4">Issued</th>
                  <th className="py-2 pr-4">Activated</th>
                  <th className="py-2 pr-4">Activation</th>
                  <th className="py-2 pr-4">Expiry Before Act</th>
                  <th className="py-2 pr-4">Created → Activated</th>
                  <th className="py-2 pr-4">Activated → TP1</th>
                  <th className="py-2">Activated → Stop</th>
                </tr>
              </thead>
              <tbody>
                {quality.signal_timing_diagnostics.map(row => (
                  <tr key={`${row.pair}-${row.session}`}>
                    <td className="py-3 pr-4 apex-table-highlight">{row.pair} • {row.session}</td>
                    <td className="py-3 pr-4">{row.signals_issued}</td>
                    <td className="py-3 pr-4">{row.signals_activated}</td>
                    <td className="py-3 pr-4">{formatPercent(row.activation_rate)}</td>
                    <td className="py-3 pr-4">{formatPercent(row.expiry_before_activation_rate)}</td>
                    <td className="py-3 pr-4">{formatDuration(row.average_time_to_activation_ms)}</td>
                    <td className="py-3 pr-4">{formatDuration(row.average_time_from_activated_to_tp1_ms)}</td>
                    <td className="py-3">{formatDuration(row.average_time_from_activated_to_stop_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataPanel>

        <DataPanel title="Pair Quality Summary" eyebrow="Current Active FX Scope">
          <div className="space-y-3">
            {quality.by_pair.map(row => (
              <div key={row.pair} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4 text-xs text-[var(--apex-text-secondary)]">
                <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{row.pair}</p>
                <p className="mt-2">Issued {row.signals_issued} • Activated {row.signals_activated} • Veto {row.veto_count}</p>
                <p className="mt-1 text-[var(--apex-text-tertiary)]">TP1 {formatPercent(row.tp1_hit_rate)} • Stop {formatPercent(row.stop_out_rate)} • Expiry {formatPercent(row.expiry_rate)}</p>
                <p className="mt-1 text-[var(--apex-text-tertiary)]">Avg activation {formatDuration(row.average_time_to_activation_ms)} • TP1 {formatDuration(row.average_time_to_tp1_ms)}</p>
              </div>
            ))}
          </div>
        </DataPanel>
      </section>
    </ApexShell>
  );
}
