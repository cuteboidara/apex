import Link from "next/link";

import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { AlphaAnalyticsRefreshButton } from "@/src/dashboard/components/AlphaAnalyticsRefreshButton";
import { DataPanel } from "@/src/dashboard/components/DataPanel";
import { MetricCard } from "@/src/dashboard/components/MetricCard";
import { StatusBadge } from "@/src/dashboard/components/StatusBadge";
import { ValidationRunGenerateButton } from "@/src/dashboard/components/ValidationRunGenerateButton";
import { getSystemStatusData, getValidationPageData } from "@/src/dashboard/data";
import type { RecommendationEffectivenessVerdict } from "@/src/interfaces/contracts";
import type { AssetPromotionReadiness, CalibrationReliabilityBand, RuntimeHealthState } from "@/src/application/analytics/alphaTypes";

function formatDate(ts: number | null) {
  if (ts == null) {
    return "n/a";
  }

  return new Date(ts).toLocaleString();
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatRate(value: number | null) {
  if (value == null) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

function formatSignedMetric(value: number | null) {
  if (value == null) {
    return "n/a";
  }
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function formatDuration(value: number) {
  const hours = value / (60 * 60 * 1000);
  if (hours < 24) {
    return `${hours.toFixed(1)}h`;
  }
  return `${(hours / 24).toFixed(1)}d`;
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

function getReliabilityTone(band: CalibrationReliabilityBand): "good" | "warn" | "bad" | "neutral" {
  if (band === "high") return "good";
  if (band === "medium") return "warn";
  if (band === "low") return "warn";
  if (band === "insufficient") return "bad";
  return "neutral";
}

function getRuntimeTone(state: RuntimeHealthState): "good" | "warn" | "bad" | "neutral" {
  if (state === "healthy") return "good";
  if (state === "degraded") return "warn";
  if (state === "broken") return "bad";
  return "neutral";
}

function getPromotionTone(state: AssetPromotionReadiness["promotionState"]): "good" | "warn" | "bad" | "neutral" {
  if (state === "promotion_ready") return "good";
  if (state === "analytically_strong_uncalibrated" || state === "shadow_validating") return "warn";
  if (state === "provider_limited" || state === "runtime_broken") return "bad";
  return "neutral";
}

export async function ValidationPage() {
  const [validation, status] = await Promise.all([
    getValidationPageData(),
    getSystemStatusData(),
  ]);
  const latestRun = validation.latest_run;
  const beneficialCount = validation.recommendation_effectiveness.filter(result => result.verdict === "beneficial").length;
  const harmfulCount = validation.recommendation_effectiveness.filter(result => result.verdict === "harmful").length;
  const averageStability = validation.pair_stability.length === 0
    ? null
    : validation.pair_stability.reduce((sum, row) => sum + row.stability_score, 0) / validation.pair_stability.length;
  const alphaAnalytics = validation.alpha_analytics;
  const promotionReadyCount = alphaAnalytics?.promotionReadiness.filter(row => row.promotionState === "promotion_ready").length ?? 0;
  const providerLimitedCount = alphaAnalytics?.promotionReadiness.filter(row => row.promotionState === "provider_limited").length ?? 0;
  const runtimeBrokenCount = alphaAnalytics?.promotionReadiness.filter(row => row.promotionState === "runtime_broken").length ?? 0;
  const latestSmokeGeneratedAt = alphaAnalytics?.liveSmoke?.generatedAt ?? null;

  return (
    <ApexShell
      title="Walk-Forward Validation"
      subtitle="Out-of-sample validation of approved pair-profile changes for the active FX intraday runtime. Validation runs compare observation windows to forward windows without auto-applying any new recommendations."
      mode={status.mode}
    >
      <section className="flex flex-wrap justify-end gap-3">
        <AlphaAnalyticsRefreshButton />
        <ValidationRunGenerateButton />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Active Universe"
          value={String(validation.active_symbols.length)}
          detail={validation.active_symbols.join(", ") || "No active FX pairs"}
        />
        <MetricCard
          label="Latest Run"
          value={latestRun ? latestRun.run_id : "none"}
          detail={latestRun ? formatDate(latestRun.generated_at) : "Generate the first run"}
          tone={latestRun ? "good" : "neutral"}
        />
        <MetricCard
          label="Effectiveness Rows"
          value={String(validation.recommendation_effectiveness.length)}
          detail={latestRun ? `${formatDuration(latestRun.observation_window_ms)} obs / ${formatDuration(latestRun.forward_window_ms)} fwd` : "No validation data"}
        />
        <MetricCard
          label="Beneficial / Harmful"
          value={`${beneficialCount} / ${harmfulCount}`}
          detail={validation.recommendation_effectiveness.length === 0 ? "No approved recommendations validated yet" : "Latest run verdict mix"}
          tone={harmfulCount > beneficialCount ? "bad" : beneficialCount > 0 ? "good" : "warn"}
        />
        <MetricCard
          label="Avg Stability"
          value={averageStability == null ? "n/a" : formatPercent(averageStability)}
          detail={validation.pair_stability[0] ? `${validation.pair_stability[0].pair} highest ranked` : "No stability windows yet"}
          tone={averageStability == null ? "neutral" : getStabilityTone(averageStability)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Alpha Report"
          value={alphaAnalytics ? formatDate(alphaAnalytics.generatedAt) : "none"}
          detail={alphaAnalytics ? `${alphaAnalytics.lookbackDays}d lookback · ${alphaAnalytics.calibrationVersion}` : "Refresh alpha analytics to build calibration and promotion evidence."}
          tone={alphaAnalytics ? "good" : "neutral"}
        />
        <MetricCard
          label="Latest Live Smoke"
          value={latestSmokeGeneratedAt ? formatDate(latestSmokeGeneratedAt) : "none"}
          detail={alphaAnalytics?.liveSmoke ? `${alphaAnalytics.liveSmoke.rows.length} runtime rows captured` : "No live provider verification captured yet."}
          tone={alphaAnalytics?.liveSmoke ? "good" : "warn"}
        />
        <MetricCard
          label="Promotion Ready"
          value={String(promotionReadyCount)}
          detail={alphaAnalytics ? "Asset classes currently eligible for publishable promotion." : "No promotion analysis yet."}
          tone={promotionReadyCount > 0 ? "good" : "neutral"}
        />
        <MetricCard
          label="Provider Limited"
          value={String(providerLimitedCount)}
          detail="Asset classes still materially constrained by provider quality."
          tone={providerLimitedCount > 0 ? "warn" : "good"}
        />
        <MetricCard
          label="Runtime Broken"
          value={String(runtimeBrokenCount)}
          detail="Asset classes blocked by live smoke verification."
          tone={runtimeBrokenCount > 0 ? "bad" : "good"}
        />
      </section>

      {alphaAnalytics ? (
        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <DataPanel title="Promotion Readiness" eyebrow="Measured rollout state by asset class">
            <div className="space-y-3">
              {alphaAnalytics.promotionReadiness.map(row => (
                <div key={row.assetClass} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-[var(--apex-font-mono)] text-sm uppercase tracking-[0.12em] text-[var(--apex-text-accent)]">{row.assetClass}</p>
                      <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">{row.note}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={row.runtimeHealth.replaceAll("_", " ")} tone={getRuntimeTone(row.runtimeHealth)} />
                      <StatusBadge label={row.promotionState.replaceAll("_", " ")} tone={getPromotionTone(row.promotionState)} />
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)] md:grid-cols-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[var(--apex-text-tertiary)]">Calibration sample</span>
                      <span>{row.calibrationSampleSize}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[var(--apex-text-tertiary)]">Calibration state</span>
                      <span>{row.calibrationState.replaceAll("_", " ")}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[var(--apex-text-tertiary)]">Average realized R</span>
                      <span>{formatSignedMetric(row.averageRealizedR)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[var(--apex-text-tertiary)]">Provider-limited rate</span>
                      <span>{formatRate(row.providerLimitedRate)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </DataPanel>

          <DataPanel title="Calibration Readiness" eyebrow="Raw confidence vs realized outcome reliability">
            <div className="space-y-3">
              {alphaAnalytics.calibrationByAsset.map(summary => (
                <div key={summary.assetClass} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-[var(--apex-font-mono)] text-sm uppercase tracking-[0.12em] text-[var(--apex-text-accent)]">{summary.assetClass}</p>
                      <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">{summary.calibrationVersion} · {summary.calibrationRegime}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge label={summary.confidenceReliabilityBand} tone={getReliabilityTone(summary.confidenceReliabilityBand)} />
                      <StatusBadge label={summary.calibrationState.replaceAll("_", " ")} tone={summary.calibrationState === "calibrated_and_trustworthy" ? "good" : summary.calibrationState === "low_sample" ? "bad" : "warn"} />
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)] md:grid-cols-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[var(--apex-text-tertiary)]">Sample size</span>
                      <span>{summary.calibrationSampleSize}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[var(--apex-text-tertiary)]">Buckets</span>
                      <span>{summary.buckets.length}</span>
                    </div>
                  </div>
                  {summary.buckets.length > 0 ? (
                    <div className="mt-4 grid gap-2 md:grid-cols-2">
                      {summary.buckets.slice(0, 4).map(bucket => (
                        <div key={`${summary.assetClass}-${bucket.confidenceMin}`} className="rounded-[var(--apex-radius-sm)] border border-[var(--apex-border-subtle)] px-3 py-3 text-xs text-[var(--apex-text-secondary)]">
                          <div className="flex items-center justify-between gap-3 font-[var(--apex-font-mono)]">
                            <span>{bucket.confidenceMin}-{bucket.confidenceMax}</span>
                            <span>{bucket.sampleSize} samples</span>
                          </div>
                          <div className="mt-2 space-y-1">
                            <p>TP1 {formatRate(bucket.tp1Rate)} · Stop {formatRate(bucket.stopOutRate)}</p>
                            <p>Expectancy {formatSignedMetric(bucket.averageRealizedR)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-[var(--apex-text-tertiary)]">No calibrated outcome buckets available yet.</p>
                  )}
                </div>
              ))}
            </div>
          </DataPanel>
        </section>
      ) : null}

      {alphaAnalytics?.liveSmoke ? (
        <DataPanel title="Live Runtime Smoke" eyebrow="Real-provider runtime verification">
          <div className="overflow-x-auto">
            <table className="apex-table min-w-[980px]">
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Runtime</th>
                  <th>Provider Status</th>
                  <th>Providers</th>
                  <th>Stage Counts</th>
                  <th>Null Prices</th>
                  <th>Freshness</th>
                  <th>Publication</th>
                </tr>
              </thead>
              <tbody>
                {alphaAnalytics.liveSmoke.rows.map(row => (
                  <tr key={row.assetClass}>
                    <td className="font-[var(--apex-font-mono)] uppercase tracking-[0.12em] text-[var(--apex-text-primary)]">{row.assetClass}</td>
                    <td><StatusBadge label={row.runtimeHealth.replaceAll("_", " ")} tone={getRuntimeTone(row.runtimeHealth)} /></td>
                    <td>{row.providerStatus ?? "unknown"}</td>
                    <td>{row.providersObserved.join(", ") || row.providerChain.join(" -> ")}</td>
                    <td className="text-xs">
                      {row.stageCounts.marketSnapshotCount}/{row.stageCounts.tradeCandidateCount}/{row.stageCounts.executableSignalCount}/{row.stageCounts.publishedCount}
                    </td>
                    <td>{row.nullPriceCount}</td>
                    <td>{row.averageFreshnessMs != null ? `${Math.round(row.averageFreshnessMs / 1000)}s avg` : "n/a"}</td>
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
        </DataPanel>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <DataPanel title="Pair Stability Ranking" eyebrow="Rolling Walk-Forward Windows">
          <div className="space-y-3">
            {validation.pair_stability.map(row => (
              <div key={row.pair} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{row.pair}</p>
                    <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">{row.windows_observed} windows observed</p>
                  </div>
                  <StatusBadge label={formatPercent(row.stability_score)} tone={getStabilityTone(row.stability_score)} />
                </div>
                <div className="mt-4 grid gap-2 font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-secondary)] md:grid-cols-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--apex-text-tertiary)]">TP1 consistency</span>
                    <span>{formatPercent(row.tp1_consistency_score)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--apex-text-tertiary)]">Calibration stability</span>
                    <span>{formatPercent(row.confidence_calibration_stability_score)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--apex-text-tertiary)]">Veto stability</span>
                    <span>{formatPercent(row.veto_reason_stability_score)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[var(--apex-text-tertiary)]">Session consistency</span>
                    <span>{formatPercent(row.session_consistency_score)}</span>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {row.stop_clustering_flag ? <StatusBadge label="stop clustering" tone="bad" /> : null}
                  {row.deterioration_flag ? <StatusBadge label="deterioration" tone="warn" /> : null}
                </div>
                <div className="mt-3 space-y-1 text-xs text-[var(--apex-text-secondary)]">
                  {row.notes.map(note => (
                    <p key={note}>{note}</p>
                  ))}
                </div>
              </div>
            ))}
            {validation.pair_stability.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No pair stability scores are available yet.</p> : null}
          </div>
        </DataPanel>

        <DataPanel title="Latest Effectiveness History" eyebrow="Approved Recommendation Outcomes">
          <div className="space-y-3">
            {validation.recommendation_effectiveness.map(result => (
              <div key={result.history_id} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{result.pair}</p>
                    <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">{formatDate(result.applied_at)}</p>
                  </div>
                  <StatusBadge label={result.verdict} tone={getVerdictTone(result.verdict)} />
                </div>
                <p className="mt-3 text-xs text-[var(--apex-text-secondary)]">
                  TP1 {formatPercent(result.pre_change_vs_post_change.pre_change.metrics.tp1_hit_rate)}
                  {" → "}
                  {formatPercent(result.pre_change_vs_post_change.post_change.metrics.tp1_hit_rate)}
                  {" · "}
                  Stop {formatPercent(result.pre_change_vs_post_change.pre_change.metrics.stop_out_rate)}
                  {" → "}
                  {formatPercent(result.pre_change_vs_post_change.post_change.metrics.stop_out_rate)}
                </p>
                <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">
                  Veto {formatPercent(result.pre_change_vs_post_change.pre_change.veto_rate)}
                  {" → "}
                  {formatPercent(result.pre_change_vs_post_change.post_change.veto_rate)}
                </p>
                <div className="mt-4">
                  <Link
                    href={latestRun ? `/validation/${latestRun.run_id}` : "/validation"}
                    className="apex-link-button"
                  >
                    Review Comparisons
                  </Link>
                </div>
              </div>
            ))}
            {validation.recommendation_effectiveness.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No approved recommendation effectiveness rows exist yet.</p> : null}
          </div>
        </DataPanel>
      </section>

      <DataPanel title="Walk-Forward Runs" eyebrow="Versioned Validation Snapshots">
        <div className="grid gap-3 lg:grid-cols-2">
          {validation.runs.map(run => (
            <div key={run.run_id} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{run.run_id}</p>
                  <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">{formatDate(run.generated_at)}</p>
                </div>
                <StatusBadge
                  label={`${run.recommendation_effectiveness.length} effects`}
                  tone={run.recommendation_effectiveness.some(result => result.verdict === "harmful") ? "warn" : "good"}
                />
              </div>
              <p className="mt-3 text-xs text-[var(--apex-text-secondary)]">{run.active_symbols.join(", ")}</p>
              <p className="mt-1 text-xs text-[var(--apex-text-tertiary)]">
                Observation {formatDuration(run.observation_window_ms)} · Forward {formatDuration(run.forward_window_ms)} · Rolling {formatDuration(run.rolling_window_ms)}
              </p>
              <div className="mt-4">
                <Link
                  href={`/validation/${run.run_id}`}
                  className="apex-link-button"
                >
                  Open Run Detail
                </Link>
              </div>
            </div>
          ))}
          {validation.runs.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No walk-forward validation runs recorded yet.</p> : null}
        </div>
      </DataPanel>
    </ApexShell>
  );
}
