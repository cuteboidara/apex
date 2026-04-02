import { getApexRuntime } from "@/src/lib/runtime";
import { createId } from "@/src/lib/ids";
import { TelegramNotifier } from "@/src/lib/telegram";
import type { AlphaAnalyticsReport } from "@/src/application/analytics/alphaTypes";
import { runAlphaAnalyticsRefresh } from "@/src/application/analytics/alphaReport";

export type DailyAlphaReportSummary = {
  generatedAt: number;
  newOutcomesByAsset: Record<string, number>;
  runtimeHealthTransitions: string[];
  promotionStateChanges: string[];
  calibrationAlerts: string[];
  delivery: "telegram_sent" | "stored_only";
};

function buildTelegramBody(report: AlphaAnalyticsReport): string {
  const lines = [
    `APEX Daily Alpha Report`,
    new Date(report.generatedAt).toISOString(),
    "--------------------",
  ];

  for (const row of report.promotionReadiness) {
    lines.push(`${row.assetClass}: ${row.promotionState} | runtime=${row.runtimeHealth} | samples=${row.calibrationSampleSize} | avgR=${row.averageRealizedR ?? "n/a"}`);
  }

  const alerts = report.calibrationByAsset
    .filter(summary => summary.calibrationWarning)
    .map(summary => `${summary.assetClass}: ${summary.calibrationWarning}`);
  if (alerts.length > 0) {
    lines.push("--------------------");
    lines.push(...alerts);
  }

  return lines.join("\n");
}

export async function generateDailyAlphaReport(input?: {
  includeSmoke?: boolean;
}): Promise<DailyAlphaReportSummary> {
  const report = await runAlphaAnalyticsRefresh({
    includeSmoke: input?.includeSmoke !== false,
  });

  const newOutcomesByAsset = Object.fromEntries(
    report.performanceByAsset.map(row => [row.assetClass, row.resolvedCount]),
  );
  const runtimeHealthTransitions = report.liveSmokeDashboard?.alerts.map(alert =>
    `${alert.assetClass}: ${alert.from} -> ${alert.to}`,
  ) ?? [];
  const promotionStateChanges = report.promotionReadiness
    .filter(row => row.analyticalPromotionEligible || row.productionPromotionEligible)
    .map(row => `${row.assetClass}: ${row.promotionState}`);
  const calibrationAlerts = report.calibrationByAsset
    .filter(summary => summary.calibrationWarning)
    .map(summary => `${summary.assetClass}: ${summary.calibrationWarning}`);

  const summary: DailyAlphaReportSummary = {
    generatedAt: report.generatedAt,
    newOutcomesByAsset,
    runtimeHealthTransitions,
    promotionStateChanges,
    calibrationAlerts,
    delivery: "stored_only",
  };

  const notifier = new TelegramNotifier();
  if (notifier.isConfigured()) {
    const delivered = await notifier.sendMessage(buildTelegramBody(report));
    if (delivered) {
      summary.delivery = "telegram_sent";
    }
  }

  await getApexRuntime().repository.appendSystemEvent({
    event_id: createId("sysevt"),
    ts: report.generatedAt,
    module: "daily-alpha-report",
    type: "daily_alpha_report_generated",
    reason: summary.delivery,
    payload: summary as unknown as Record<string, unknown>,
  });

  return summary;
}
