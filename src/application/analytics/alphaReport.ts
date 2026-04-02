import { createId } from "@/src/lib/ids";
import { getApexRuntime } from "@/src/lib/runtime";
import { prisma } from "@/src/infrastructure/db/prisma";
import type { SignalAssetClass } from "@/src/domain/models/signalHealth";
import type {
  AlphaAnalyticsReport,
  AssetCalibrationBucket,
  AssetCalibrationSummary,
  CalibrationCurvePoint,
  AssetGradeCalibrationRow,
  AssetPerformanceSummary,
  AssetPromotionReadiness,
  CalibrationReliabilityBand,
  CalibrationState,
  ProviderReliabilitySummary,
  PromotionReadinessState,
  RuntimeSmokeReportRow,
} from "@/src/application/analytics/alphaTypes";
import { getLatestLiveRuntimeSmokeReport, getLiveRuntimeSmokeDashboard, runLiveRuntimeSmokeVerification } from "@/src/application/analytics/liveRuntimeVerification";
import { getProviderReliabilitySummaries } from "@/src/application/analytics/providerDiagnostics";
import {
  CROSS_ASSET_CALIBRATION_VERSION,
  getCrossAssetCalibrationProfile,
} from "@/src/application/calibration/crossAssetWeights";
import { resolveOutcomeDataQuality } from "@/src/assets/shared/providerHealth";
import { refreshOutcomeAnalytics, refreshTradePlanDiagnostics } from "@/lib/tradePlanDiagnostics";

const CALIBRATION_VERSION = CROSS_ASSET_CALIBRATION_VERSION;
const ASSET_CLASSES: SignalAssetClass[] = ["fx", "crypto", "stock", "commodity", "index", "memecoin"];
const ACCEPT_DEGRADED_OUTCOMES = (process.env.APEX_ACCEPT_DEGRADED_OUTCOMES ?? "true").toLowerCase() !== "false";

type TradePlanOutcomeRow = {
  signalId: string;
  symbol: string;
  assetClass: string;
  style: string;
  setupFamily: string | null;
  bias: string;
  confidence: number;
  publicationRank: string | null;
  publicationStatus: string | null;
  providerAtSignal: string | null;
  providerHealthStateAtSignal: string | null;
  providerFallbackUsedAtSignal: boolean;
  dataQuality: string | null;
  regimeTag: string | null;
  qualityGateReason: string | null;
  outcome: string | null;
  detectedAt: Date | null;
  entryHitAt: Date | null;
  stopHitAt: Date | null;
  tp1HitAt: Date | null;
  tp2HitAt: Date | null;
  tp3HitAt: Date | null;
  invalidatedAt: Date | null;
  expiredAt: Date | null;
  realizedRR: number | null;
  maxFavorableExcursion: number | null;
  maxAdverseExcursion: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export function resolveAssetClass(value: string | null | undefined): SignalAssetClass | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized === "forex" || normalized === "fx") return "fx";
  if (normalized === "crypto") return "crypto";
  if (normalized === "stock" || normalized === "stocks") return "stock";
  if (normalized === "commodity" || normalized === "commodities") return "commodity";
  if (normalized === "index" || normalized === "indices") return "index";
  if (normalized === "memecoin" || normalized === "meme" || normalized === "meme_coin") return "memecoin";
  return null;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readSignalStrategyValue(rawData: unknown, key: string): string | null {
  const strategy = asRecord(asRecord(rawData).strategy);
  const value = strategy[key];
  return typeof value === "string" ? value : null;
}

function readSignalDiagnosticsValue(rawData: unknown, key: string): string | null {
  const diagnostics = asRecord(asRecord(rawData).diagnostics);
  const value = diagnostics[key];
  return typeof value === "string" ? value : null;
}

function readStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readStoredTradePlan(rawData: unknown, style: string): Record<string, unknown> {
  const strategy = asRecord(asRecord(rawData).strategy);
  const tradePlans = Array.isArray(strategy.tradePlans)
    ? strategy.tradePlans.filter((item): item is Record<string, unknown> => item != null && typeof item === "object" && !Array.isArray(item))
    : [];
  return tradePlans.find(plan => readStringValue(plan.style) === style)
    ?? tradePlans[0]
    ?? {};
}

function roundMetric(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 1000) / 1000;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return roundMetric(numerator / denominator);
}

function isTriggered(row: TradePlanOutcomeRow): boolean {
  if (row.entryHitAt) {
    return true;
  }

  return [
    "OPEN",
    "TP1",
    "TP2",
    "TP3",
    "STOP",
    "STOP_AFTER_TP1",
    "STOP_AFTER_TP2",
  ].includes(String(row.outcome ?? "").toUpperCase());
}

function isPositive(row: TradePlanOutcomeRow): boolean {
  return typeof row.realizedRR === "number" && Number.isFinite(row.realizedRR) && row.realizedRR > 0;
}

function isStoppedOut(row: TradePlanOutcomeRow): boolean {
  return [
    "STOP",
    "STOP_AFTER_TP1",
    "STOP_AFTER_TP2",
  ].includes(String(row.outcome ?? "").toUpperCase());
}

function isResolved(row: TradePlanOutcomeRow): boolean {
  const outcome = String(row.outcome ?? "").toUpperCase();
  return Boolean(
    row.stopHitAt
    || row.tp1HitAt
    || row.tp2HitAt
    || row.tp3HitAt
    || row.invalidatedAt
    || row.expiredAt
    || outcome === "STOP"
    || outcome === "STOP_AFTER_TP1"
    || outcome === "STOP_AFTER_TP2"
    || outcome === "TP1"
    || outcome === "TP2"
    || outcome === "TP3"
    || outcome === "INVALIDATED"
    || outcome === "EXPIRED",
  );
}

function isProviderLimited(row: TradePlanOutcomeRow): boolean {
  return row.providerFallbackUsedAtSignal || String(row.providerHealthStateAtSignal ?? "").toUpperCase() !== "HEALTHY";
}

function durationHours(row: TradePlanOutcomeRow): number | null {
  const start = row.entryHitAt ?? row.detectedAt ?? row.createdAt;
  const end = row.tp3HitAt
    ?? row.tp2HitAt
    ?? row.tp1HitAt
    ?? row.stopHitAt
    ?? row.invalidatedAt
    ?? row.expiredAt
    ?? row.updatedAt;

  if (!start || !end) {
    return null;
  }

  const hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
  return Number.isFinite(hours) && hours >= 0 ? hours : null;
}

export function deriveCalibrationReliabilityBand(sampleSize: number): CalibrationReliabilityBand {
  if (sampleSize < 12) return "insufficient";
  if (sampleSize < 30) return "low";
  if (sampleSize < 80) return "medium";
  return "high";
}

function deriveCalibrationState(
  sampleSize: number,
  averageRealizedR: number | null,
  positiveExpectancyRate: number | null,
): CalibrationState {
  if (sampleSize < 12) {
    return "low_sample";
  }
  if ((averageRealizedR ?? 0) > 0 && (positiveExpectancyRate ?? 0) >= 0.5) {
    return "calibrated_and_trustworthy";
  }
  return "analytically_strong_uncalibrated";
}

function buildBucketRows(assetClass: SignalAssetClass, rows: TradePlanOutcomeRow[]): AssetCalibrationBucket[] {
  const grouped = new Map<number, TradePlanOutcomeRow[]>();

  for (const row of rows) {
    const lower = Math.max(0, Math.min(90, Math.floor(row.confidence / 10) * 10));
    const bucket = grouped.get(lower) ?? [];
    bucket.push(row);
    grouped.set(lower, bucket);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([confidenceMin, bucketRows]) => {
      const triggeredRows = bucketRows.filter(isTriggered);
      const resolvedRows = bucketRows.filter(isResolved);
      const positiveRows = resolvedRows.filter(isPositive);
      return {
        assetClass,
        confidenceMin,
        confidenceMax: confidenceMin + 9,
        sampleSize: bucketRows.length,
        triggeredRate: rate(triggeredRows.length, bucketRows.length),
        tp1Rate: rate(bucketRows.filter(row => row.tp1HitAt != null).length, triggeredRows.length),
        tp2Rate: rate(bucketRows.filter(row => row.tp2HitAt != null || row.tp3HitAt != null).length, triggeredRows.length),
        stopOutRate: rate(bucketRows.filter(isStoppedOut).length, triggeredRows.length),
        positiveExpectancyRate: rate(positiveRows.length, resolvedRows.length),
        averageRealizedR: roundMetric(average(resolvedRows
          .map(row => row.realizedRR)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value)))),
        winRateAfterTrigger: rate(triggeredRows.filter(isPositive).length, triggeredRows.length),
      };
    });
}

function buildCalibrationCurve(buckets: AssetCalibrationBucket[]): CalibrationCurvePoint[] {
  return buckets.map(bucket => {
    const confidenceMid = (bucket.confidenceMin + bucket.confidenceMax) / 2 / 100;
    const actualWinRate = bucket.winRateAfterTrigger;
    return {
      confidenceMin: bucket.confidenceMin,
      confidenceMax: bucket.confidenceMax,
      confidenceMid,
      sampleSize: bucket.sampleSize,
      actualWinRate,
      expectedWinRate: confidenceMid,
      calibrationGap: actualWinRate == null ? null : roundMetric(actualWinRate - confidenceMid),
    };
  });
}

function inferMiscalibratedComponent(input: {
  assetClass: SignalAssetClass;
  averageRealizedR: number | null;
  providerLimitedRate: number | null;
  buckets: AssetCalibrationBucket[];
}): "structure" | "market" | "execution" | "data" | "assetFit" | null {
  if ((input.providerLimitedRate ?? 0) >= 0.35) {
    return "data";
  }

  const highConfidenceBucket = input.buckets.find(bucket => bucket.confidenceMin >= 80 && bucket.confidenceMin < 90);
  if (!highConfidenceBucket || highConfidenceBucket.winRateAfterTrigger == null) {
    return null;
  }

  if (highConfidenceBucket.stopOutRate != null && highConfidenceBucket.stopOutRate > 0.45) {
    return "execution";
  }
  if ((highConfidenceBucket.triggeredRate ?? 1) < 0.4) {
    return "market";
  }
  if ((input.averageRealizedR ?? 0) <= 0) {
    return input.assetClass === "commodity" || input.assetClass === "index" ? "assetFit" : "structure";
  }

  return null;
}

export function buildCalibrationSummaryForAsset(
  assetClass: SignalAssetClass,
  rows: TradePlanOutcomeRow[],
): AssetCalibrationSummary {
  const buckets = buildBucketRows(assetClass, rows);
  const curve = buildCalibrationCurve(buckets);
  const resolvedRows = rows.filter(isResolved);
  const averageRealizedR = average(resolvedRows
    .map(row => row.realizedRR)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value)));
  const positiveExpectancyRate = rate(resolvedRows.filter(isPositive).length, resolvedRows.length);
  const sampleSize = rows.length;
  const providerLimitedRate = rate(rows.filter(isProviderLimited).length, rows.length);
  const weightProfile = getCrossAssetCalibrationProfile(assetClass, sampleSize);
  const miscalibratedComponent = inferMiscalibratedComponent({
    assetClass,
    averageRealizedR,
    providerLimitedRate,
    buckets,
  });
  const highConfidenceBucket = curve.find(point => point.confidenceMin >= 80 && point.confidenceMin < 90) ?? null;
  const calibrationWarning = highConfidenceBucket && highConfidenceBucket.actualWinRate != null
    && Math.abs((highConfidenceBucket.actualWinRate ?? 0) - highConfidenceBucket.expectedWinRate) > 0.15
    ? `80-89 confidence bucket is diverging from realized win rate by ${Math.round(Math.abs((highConfidenceBucket.actualWinRate ?? 0) - highConfidenceBucket.expectedWinRate) * 100)} points${miscalibratedComponent ? `; review ${miscalibratedComponent}` : ""}.`
    : sampleSize < 12
      ? "Calibration sample size is still too small for high-confidence promotion."
      : null;

  return {
    assetClass,
    rawConfidenceField: "confidence",
    calibratedConfidenceField: "calibratedConfidence",
    calibrationVersion: CALIBRATION_VERSION,
    calibrationSampleSize: sampleSize,
    calibrationRegime: `last_${sampleSize}_signals`,
    confidenceReliabilityBand: deriveCalibrationReliabilityBand(sampleSize),
    calibrationState: deriveCalibrationState(sampleSize, averageRealizedR, positiveExpectancyRate),
    experimental: weightProfile.experimental,
    weightProfile,
    miscalibratedComponent,
    calibrationWarning,
    buckets,
    curve,
  };
}

export function buildPerformanceSummaryForAsset(
  assetClass: SignalAssetClass,
  rows: TradePlanOutcomeRow[],
): AssetPerformanceSummary {
  const triggeredRows = rows.filter(isTriggered);
  const resolvedRows = rows.filter(isResolved);
  const positiveRows = resolvedRows.filter(isPositive);

  return {
    assetClass,
    sampleSize: rows.length,
    resolvedCount: resolvedRows.length,
    triggeredCount: triggeredRows.length,
    winRate: rate(positiveRows.length, resolvedRows.length),
    tp1Rate: rate(rows.filter(row => row.tp1HitAt != null).length, triggeredRows.length),
    stopOutRate: rate(rows.filter(isStoppedOut).length, triggeredRows.length),
    averageRealizedR: roundMetric(average(resolvedRows
      .map(row => row.realizedRR)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value)))),
    positiveExpectancyRate: rate(positiveRows.length, resolvedRows.length),
    providerLimitedRate: rate(rows.filter(isProviderLimited).length, rows.length),
  };
}

export function buildGradeCalibrationRows(
  assetClass: SignalAssetClass,
  rows: TradePlanOutcomeRow[],
): AssetGradeCalibrationRow[] {
  const grouped = new Map<string, TradePlanOutcomeRow[]>();

  for (const row of rows) {
    const grade = row.publicationRank ?? "Silent";
    const bucket = grouped.get(grade) ?? [];
    bucket.push(row);
    grouped.set(grade, bucket);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([grade, gradeRows]) => {
      const triggeredRows = gradeRows.filter(isTriggered);
      const resolvedRows = gradeRows.filter(isResolved);
      const durations = gradeRows
        .map(durationHours)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

      return {
        assetClass,
        grade,
        sampleSize: gradeRows.length,
        tp1Rate: rate(gradeRows.filter(row => row.tp1HitAt != null).length, triggeredRows.length),
        stopOutRate: rate(gradeRows.filter(isStoppedOut).length, triggeredRows.length),
        expectancy: roundMetric(average(resolvedRows
          .map(row => row.realizedRR)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value)))),
        averageRealizedR: roundMetric(average(resolvedRows
          .map(row => row.realizedRR)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value)))),
        averageDurationHours: roundMetric(average(durations)),
        providerLimitedRate: rate(gradeRows.filter(isProviderLimited).length, gradeRows.length),
      };
    });
}

export function shouldIncludeOutcomeRow(
  row: TradePlanOutcomeRow,
  options?: { acceptDegradedOutcomes?: boolean },
): boolean {
  const acceptDegradedOutcomes = options?.acceptDegradedOutcomes ?? ACCEPT_DEGRADED_OUTCOMES;
  if (acceptDegradedOutcomes) {
    return true;
  }

  return row.dataQuality !== "fallback" && row.dataQuality !== "degraded";
}

export function derivePromotionReadiness(input: {
  assetClass: SignalAssetClass;
  smoke: RuntimeSmokeReportRow | null;
  calibration: AssetCalibrationSummary;
  performance: AssetPerformanceSummary;
  providerReliability: ProviderReliabilitySummary[];
}): AssetPromotionReadiness {
  const runtimeHealth = input.smoke?.runtimeHealth ?? "broken";
  const providerScore = input.providerReliability.length === 0
    ? 0
    : Math.round(input.providerReliability.reduce((sum, summary) => sum + summary.recentScore, 0) / input.providerReliability.length);
  const providerLimitedRate = input.performance.providerLimitedRate;
  const expectancy = input.performance.averageRealizedR;
  const nullPriceRate = input.smoke && input.smoke.stageCounts.symbolsAttempted > 0
    ? input.smoke.nullPriceCount / input.smoke.stageCounts.symbolsAttempted
    : null;
  const analyticalPromotionEligible = input.calibration.calibrationSampleSize > 30
    && (input.performance.winRate ?? 0) > 0.5
    && (input.performance.averageRealizedR ?? 0) > 1.5;
  const productionPromotionEligible = runtimeHealth === "healthy"
    && (nullPriceRate ?? 1) < 0.05;

  let promotionState: PromotionReadinessState;
  let note: string;

  if (runtimeHealth === "broken") {
    promotionState = "runtime_broken";
    note = "Live smoke verification still shows a broken runtime path.";
  } else if (
    runtimeHealth === "degraded"
    || (providerLimitedRate ?? 0) >= 0.35
    || providerScore < 45
  ) {
    promotionState = "provider_limited";
    note = "Provider degradation is still materially affecting runtime health or historical outcomes.";
  } else if (productionPromotionEligible && analyticalPromotionEligible) {
    promotionState = "production";
    note = "Outcome thresholds and runtime health both cleared the production promotion gate.";
  } else if (analyticalPromotionEligible) {
    promotionState = "analytically_ready";
    note = "Outcome thresholds are strong enough for analytical promotion, but runtime health is not yet production grade.";
  } else if (input.calibration.calibrationSampleSize < 12) {
    promotionState = "shadow_validating";
    note = "Calibration sample size is still too thin for promotion beyond shadow/watchlist handling.";
  } else if (
    input.calibration.calibrationState !== "calibrated_and_trustworthy"
    || expectancy == null
    || expectancy <= 0
  ) {
    promotionState = "analytically_strong_uncalibrated";
    note = "Analytical structure is in place, but realized expectancy and calibration evidence are not strong enough yet.";
  } else {
    promotionState = "promotion_ready";
    note = "Runtime health, provider quality, and realized expectancy are all strong enough for promotion.";
  }

  return {
      assetClass: input.assetClass,
      runtimeHealth,
      calibrationState: input.calibration.calibrationState,
      promotionState,
      calibrationSampleSize: input.calibration.calibrationSampleSize,
      averageRealizedR: expectancy,
      providerLimitedRate,
      nullPriceRate,
      analyticalPromotionEligible,
      productionPromotionEligible,
      note,
  };
}

async function readTradePlanRows(lookbackDays: number): Promise<TradePlanOutcomeRow[]> {
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60_000);
  const rows = await prisma.tradePlan.findMany({
    where: {
      run: { status: "COMPLETED" },
      OR: [
        { detectedAt: { gte: cutoff } },
        {
          detectedAt: null,
          createdAt: { gte: cutoff },
        },
      ],
    },
    select: {
      signalId: true,
      symbol: true,
      assetClass: true,
      style: true,
      setupFamily: true,
      bias: true,
      confidence: true,
      publicationRank: true,
      providerAtSignal: true,
      providerHealthStateAtSignal: true,
      providerFallbackUsedAtSignal: true,
      regimeTag: true,
      qualityGateReason: true,
      outcome: true,
      detectedAt: true,
      entryHitAt: true,
      stopHitAt: true,
      tp1HitAt: true,
      tp2HitAt: true,
      tp3HitAt: true,
      invalidatedAt: true,
      expiredAt: true,
      realizedRR: true,
      maxFavorableExcursion: true,
      maxAdverseExcursion: true,
      createdAt: true,
      updatedAt: true,
      signal: {
        select: {
          rawData: true,
        },
      },
    },
    orderBy: {
      updatedAt: "desc",
    },
    take: 3000,
  });

  return rows.map(row => {
    const rawData = row.signal?.rawData;
    const storedTradePlan = readStoredTradePlan(rawData, row.style);
    const publicationStatus = readStringValue(storedTradePlan.publicationStatus)
      ?? readSignalStrategyValue(rawData, "publicationStatus");
    const dataQuality = readStringValue(storedTradePlan.dataQuality)
      ?? readSignalDiagnosticsValue(rawData, "dataQuality")
      ?? resolveOutcomeDataQuality({
        providerStatus: row.providerHealthStateAtSignal === "HEALTHY"
          ? "healthy"
          : row.providerFallbackUsedAtSignal
            ? "fallback"
            : "degraded",
        fallbackUsed: row.providerFallbackUsedAtSignal,
      });

    return {
      signalId: row.signalId,
      symbol: row.symbol,
      assetClass: row.assetClass,
      style: row.style,
      setupFamily: row.setupFamily,
      bias: row.bias,
      confidence: row.confidence,
      publicationRank: row.publicationRank,
      publicationStatus,
      providerAtSignal: row.providerAtSignal,
      providerHealthStateAtSignal: row.providerHealthStateAtSignal,
      providerFallbackUsedAtSignal: row.providerFallbackUsedAtSignal,
      dataQuality,
      regimeTag: row.regimeTag,
      qualityGateReason: row.qualityGateReason,
      outcome: row.outcome,
      detectedAt: row.detectedAt,
      entryHitAt: row.entryHitAt,
      stopHitAt: row.stopHitAt,
      tp1HitAt: row.tp1HitAt,
      tp2HitAt: row.tp2HitAt,
      tp3HitAt: row.tp3HitAt,
      invalidatedAt: row.invalidatedAt,
      expiredAt: row.expiredAt,
      realizedRR: row.realizedRR,
      maxFavorableExcursion: row.maxFavorableExcursion,
      maxAdverseExcursion: row.maxAdverseExcursion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });
}

export async function runAlphaAnalyticsRefresh(input?: {
  lookbackDays?: number;
  includeSmoke?: boolean;
}): Promise<AlphaAnalyticsReport> {
  const lookbackDays = Math.max(14, input?.lookbackDays ?? 60);
  const [tradePlanRefresh, outcomeRefresh, liveSmoke, providerReliability, tradePlanRows] = await Promise.all([
    refreshTradePlanDiagnostics({ maxPlans: 500 }),
    refreshOutcomeAnalytics({ lookbackDays, take: 2500 }),
    input?.includeSmoke ? runLiveRuntimeSmokeVerification() : getLatestLiveRuntimeSmokeReport(),
    getProviderReliabilitySummaries({ lookbackHours: lookbackDays * 24, forceRefresh: true }),
    readTradePlanRows(lookbackDays),
  ]);
  const liveSmokeDashboard = await getLiveRuntimeSmokeDashboard(liveSmoke);

  const rowsByAsset = new Map<SignalAssetClass, TradePlanOutcomeRow[]>();
  for (const assetClass of ASSET_CLASSES) {
    rowsByAsset.set(assetClass, []);
  }

  for (const row of tradePlanRows) {
    const assetClass = resolveAssetClass(row.assetClass);
    if (!assetClass) {
      continue;
    }
    if (!shouldIncludeOutcomeRow(row)) {
      continue;
    }
    rowsByAsset.get(assetClass)?.push(row);
  }

  const calibrationByAsset = ASSET_CLASSES.map(assetClass =>
    buildCalibrationSummaryForAsset(assetClass, rowsByAsset.get(assetClass) ?? []),
  );
  const performanceByAsset = ASSET_CLASSES.map(assetClass =>
    buildPerformanceSummaryForAsset(assetClass, rowsByAsset.get(assetClass) ?? []),
  );
  const gradeCalibrationByAsset = ASSET_CLASSES.flatMap(assetClass =>
    buildGradeCalibrationRows(assetClass, rowsByAsset.get(assetClass) ?? []),
  );
  const promotionReadiness = ASSET_CLASSES.map(assetClass =>
    derivePromotionReadiness({
      assetClass,
      smoke: liveSmoke?.rows.find(row => row.assetClass === assetClass) ?? null,
      calibration: calibrationByAsset.find(summary => summary.assetClass === assetClass)!,
      performance: performanceByAsset.find(summary => summary.assetClass === assetClass)!,
      providerReliability: providerReliability.filter(summary => summary.assetClass === assetClass),
    }),
  );

  const report: AlphaAnalyticsReport = {
    generatedAt: Date.now(),
    lookbackDays,
    calibrationVersion: CALIBRATION_VERSION,
    outcomeRefresh: {
      refreshed: true,
      tradePlanDiagnosticsUpdated: tradePlanRefresh.updatedCount,
      outcomeRowsWritten: outcomeRefresh.tradeOutcomeCount,
    },
    liveSmoke,
    liveSmokeDashboard,
    performanceByAsset,
    calibrationByAsset,
    gradeCalibrationByAsset,
    providerReliability,
    promotionReadiness,
  };

  const runtime = getApexRuntime();
  await runtime.repository.appendSystemEvent({
    event_id: createId("sysevt"),
    ts: report.generatedAt,
    module: "alpha-analytics",
    type: "alpha_analytics_report_generated",
    reason: "operator refresh",
    payload: report as unknown as Record<string, unknown>,
  });

  return report;
}

export async function getLatestAlphaAnalyticsReport(): Promise<AlphaAnalyticsReport | null> {
  const runtime = getApexRuntime();
  const latestInMemory = runtime.repository.getSystemEvents()
    .filter(event => event.type === "alpha_analytics_report_generated")
    .sort((left, right) => right.ts - left.ts)[0];
  if (latestInMemory) {
    return latestInMemory.payload as unknown as AlphaAnalyticsReport;
  }

  try {
    const latestPersisted = await prisma.systemEvent.findFirst({
      where: {
        type: "alpha_analytics_report_generated",
      },
      orderBy: {
        ts: "desc",
      },
      select: {
        payload: true,
      },
    });
    return latestPersisted?.payload as AlphaAnalyticsReport | null;
  } catch {
    return null;
  }
}

export type { TradePlanOutcomeRow };
