import { createId } from "@/src/lib/ids";
import { getApexRuntime } from "@/src/lib/runtime";
import { getLatestAlphaAnalyticsReport, runAlphaAnalyticsRefresh } from "@/src/application/analytics/alphaReport";

export async function getValidationQueuePayload() {
  const runtime = getApexRuntime();
  const latestRun = runtime.repository.getValidationRuns(1)[0] ?? null;
  const alphaAnalytics = await getLatestAlphaAnalyticsReport();

  return {
    active_symbols: runtime.config.activeSymbols,
    latest_run: latestRun,
    runs: runtime.repository.getValidationRuns(20),
    recommendation_effectiveness: latestRun?.recommendation_effectiveness ?? [],
    pair_stability: latestRun?.pair_stability ?? [],
    applied_history: runtime.repository.getAppliedRecommendationHistory(20),
    alpha_analytics: alphaAnalytics,
  };
}

export async function generateValidationRunPayload() {
  const runtime = getApexRuntime();
  const run = runtime.repository.createWalkForwardValidationRun({
    activeSymbols: runtime.config.activeSymbols,
    primaryEntryStyle: runtime.config.primaryEntryStyle,
    enabledEntryStyles: runtime.config.enabledEntryStyles,
  });

  await runtime.repository.appendSystemEvent({
    event_id: createId("sysevt"),
    ts: Date.now(),
    module: "validation",
    type: "walk_forward_run_generated",
    reason: "operator action",
    payload: {
      run_id: run.run_id,
      active_symbols: run.active_symbols,
      effectiveness_count: run.recommendation_effectiveness.length,
    },
  });

  return {
    run,
    runs: runtime.repository.getValidationRuns(20),
  };
}

export async function refreshValidationAlphaAnalytics() {
  const alphaAnalytics = await runAlphaAnalyticsRefresh({ includeSmoke: true });
  return {
    alpha_analytics: alphaAnalytics,
  };
}

export async function getValidationDetailPayload(runId: string) {
  return {
    run: getApexRuntime().repository.getValidationRun(runId),
  };
}
