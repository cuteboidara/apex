import type { SignalAssetClass } from "@/src/domain/models/signalHealth";

export type RuntimeHealthState = "healthy" | "degraded" | "broken" | "no_market_context";
export type CalibrationReliabilityBand = "insufficient" | "low" | "medium" | "high";
export type CalibrationState = "analytically_strong_uncalibrated" | "calibrated_and_trustworthy" | "low_sample";
export type PromotionReadinessState =
  | "runtime_broken"
  | "provider_limited"
  | "shadow_validating"
  | "analytically_ready"
  | "analytically_strong_uncalibrated"
  | "promotion_ready"
  | "production";

export type RuntimeSmokeStageCounts = {
  symbolsAttempted: number;
  marketSnapshotCount: number;
  tradeCandidateCount: number;
  riskEvaluatedCandidateCount: number;
  executableSignalCount: number;
  publishedCount: number;
  blockedCount: number;
};

export type RuntimeSmokeReportRow = {
  assetClass: SignalAssetClass;
  timestamp: number;
  runtimeHealth: RuntimeHealthState;
  providerChain: string[];
  providersObserved: string[];
  providerStatus: string | null;
  stageCounts: RuntimeSmokeStageCounts;
  nullPriceCount: number;
  staleCount: number;
  averageFreshnessMs: number | null;
  worstFreshnessMs: number | null;
  publicationDistribution: Record<string, number>;
  rejectionReasons: Record<string, number>;
  notes: string[];
};

export type LiveRuntimeSmokeReport = {
  generatedAt: number;
  rows: RuntimeSmokeReportRow[];
};

export type RuntimeSmokeHistoryPoint = {
  generatedAt: number;
  runtimeHealth: RuntimeHealthState;
  nullPriceCount: number;
  nullPriceRate: number;
  symbolsAttempted: number;
};

export type RuntimeHealthTransition = {
  assetClass: SignalAssetClass;
  from: RuntimeHealthState;
  to: RuntimeHealthState;
  changedAt: number;
};

export type RuntimeSmokeDashboardRow = RuntimeSmokeReportRow & {
  lastSuccessfulCycleAt: number | null;
  nullPriceTrend: RuntimeSmokeHistoryPoint[];
  transition: RuntimeHealthTransition | null;
};

export type LiveRuntimeSmokeDashboard = {
  generatedAt: number;
  rows: RuntimeSmokeDashboardRow[];
  alerts: RuntimeHealthTransition[];
};

export type CalibrationCurvePoint = {
  confidenceMin: number;
  confidenceMax: number;
  confidenceMid: number;
  sampleSize: number;
  actualWinRate: number | null;
  expectedWinRate: number;
  calibrationGap: number | null;
};

export type CrossAssetCalibrationProfileSummary = {
  assetClass: SignalAssetClass;
  version: string;
  derivedFrom: "fx" | "fx_port";
  experimental: boolean;
  weights: {
    structure: number;
    market: number;
    execution: number;
    data: number;
    assetFit: number;
  };
};

export type AssetCalibrationBucket = {
  assetClass: SignalAssetClass;
  confidenceMin: number;
  confidenceMax: number;
  sampleSize: number;
  triggeredRate: number | null;
  tp1Rate: number | null;
  tp2Rate: number | null;
  stopOutRate: number | null;
  positiveExpectancyRate: number | null;
  averageRealizedR: number | null;
  winRateAfterTrigger: number | null;
};

export type AssetCalibrationSummary = {
  assetClass: SignalAssetClass;
  rawConfidenceField: "confidence";
  calibratedConfidenceField: "calibratedConfidence";
  calibrationVersion: string;
  calibrationSampleSize: number;
  calibrationRegime: string;
  confidenceReliabilityBand: CalibrationReliabilityBand;
  calibrationState: CalibrationState;
  experimental: boolean;
  weightProfile: CrossAssetCalibrationProfileSummary;
  miscalibratedComponent: "structure" | "market" | "execution" | "data" | "assetFit" | null;
  calibrationWarning: string | null;
  buckets: AssetCalibrationBucket[];
  curve: CalibrationCurvePoint[];
};

export type AssetGradeCalibrationRow = {
  assetClass: SignalAssetClass;
  grade: string;
  sampleSize: number;
  tp1Rate: number | null;
  stopOutRate: number | null;
  expectancy: number | null;
  averageRealizedR: number | null;
  averageDurationHours: number | null;
  providerLimitedRate: number | null;
};

export type ProviderReliabilitySummary = {
  provider: string;
  assetClass: SignalAssetClass;
  attempts: number;
  successes: number;
  degradedResponses: number;
  emptyBodyResponses: number;
  averageLatencyMs: number | null;
  successRate: number;
  baseScore: number;
  recentScore: number;
  outcomeSampleSize: number;
  averageRealizedR: number | null;
  positiveExpectancyRate: number | null;
  outcomeAdjustedScore: number;
  lastRecordedAt: string | null;
  lastSuccessfulAt: string | null;
};

export type AssetPerformanceSummary = {
  assetClass: SignalAssetClass;
  sampleSize: number;
  resolvedCount: number;
  triggeredCount: number;
  winRate: number | null;
  tp1Rate: number | null;
  stopOutRate: number | null;
  averageRealizedR: number | null;
  positiveExpectancyRate: number | null;
  providerLimitedRate: number | null;
};

export type AssetPromotionReadiness = {
  assetClass: SignalAssetClass;
  runtimeHealth: RuntimeHealthState;
  calibrationState: CalibrationState;
  promotionState: PromotionReadinessState;
  calibrationSampleSize: number;
  averageRealizedR: number | null;
  providerLimitedRate: number | null;
  nullPriceRate: number | null;
  analyticalPromotionEligible: boolean;
  productionPromotionEligible: boolean;
  note: string;
};

export type AlphaAnalyticsReport = {
  generatedAt: number;
  lookbackDays: number;
  calibrationVersion: string;
  outcomeRefresh: {
    refreshed: boolean;
    tradePlanDiagnosticsUpdated: number;
    outcomeRowsWritten: number;
  };
  liveSmoke: LiveRuntimeSmokeReport | null;
  liveSmokeDashboard: LiveRuntimeSmokeDashboard | null;
  performanceByAsset: AssetPerformanceSummary[];
  calibrationByAsset: AssetCalibrationSummary[];
  gradeCalibrationByAsset: AssetGradeCalibrationRow[];
  providerReliability: ProviderReliabilitySummary[];
  promotionReadiness: AssetPromotionReadiness[];
};
