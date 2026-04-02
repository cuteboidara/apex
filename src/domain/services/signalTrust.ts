import type { PairMarketDataDiagnostics } from "@/src/interfaces/contracts";
import {
  clampSignalScore,
  toModuleHealthState,
  type ProviderStatus,
  type PublicationStatus,
  type SignalAssetClass,
  type SignalDataTrust,
  type SignalPublicationState,
  type SignalQualityScores,
  type SignalRejectionReasonCode,
} from "@/src/domain/models/signalHealth";

function normalizePercentScore(value: number | null | undefined, fallback = 0): number {
  if (value == null || !Number.isFinite(value)) {
    return fallback;
  }
  if (value <= 1) {
    return clampSignalScore(value * 100);
  }
  return clampSignalScore(value);
}

export function deriveProviderStatusFromDiagnostics(
  marketData: PairMarketDataDiagnostics | null,
  stalenessMs: number,
): ProviderStatus {
  if (!marketData?.provider || marketData.sourceMode === "unavailable" || marketData.candlesFetched <= 0) {
    return "broken";
  }

  if (
    marketData.qualityFlag === "stale_last_candle"
    || stalenessMs > 30 * 60 * 1000
  ) {
    return "stale";
  }

  if (
    marketData.sourceMode === "cache"
    || marketData.sourceMode === "synthetic"
    || marketData.usedFallback
  ) {
    return "fallback";
  }

  if (
    marketData.qualityFlag != null
    && marketData.qualityFlag !== "clean"
  ) {
    return "degraded";
  }

  return "healthy";
}

export function buildDataTrust(input: {
  assetClass: SignalAssetClass;
  providerStatus: ProviderStatus;
  priceSource: string | null;
  candleSource: string | null;
  fallbackDepth?: number;
  dataFreshnessMs?: number | null;
  missingBarCount?: number;
  lastSuccessfulProvider?: string | null;
  quoteIntegrity?: boolean;
  universeMembershipConfidence?: number;
}): SignalDataTrust {
  const fallbackDepth = Math.max(0, Math.round(input.fallbackDepth ?? 0));
  const dataFreshnessMs = input.dataFreshnessMs ?? null;
  const missingBarCount = Math.max(0, Math.round(input.missingBarCount ?? 0));
  const quoteIntegrity = input.quoteIntegrity ?? Boolean(input.priceSource || input.candleSource);
  const universeMembershipConfidence = Math.max(0, Math.min(1, input.universeMembershipConfidence ?? 1));

  let baseScore = input.providerStatus === "healthy"
    ? 92
    : input.providerStatus === "degraded"
      ? 70
      : input.providerStatus === "fallback"
        ? 58
        : input.providerStatus === "stale"
          ? 35
          : 12;

  if (fallbackDepth > 0) {
    baseScore -= Math.min(18, fallbackDepth * 8);
  }
  if (dataFreshnessMs != null && dataFreshnessMs > 0) {
    baseScore -= Math.min(24, Math.round(dataFreshnessMs / 300_000));
  }
  if (missingBarCount > 0) {
    baseScore -= Math.min(18, missingBarCount * 3);
  }
  if (!quoteIntegrity) {
    baseScore -= 28;
  }

  baseScore = Math.round(baseScore * (0.55 + universeMembershipConfidence * 0.45));

  return {
    assetClass: input.assetClass,
    providerStatus: input.providerStatus,
    priceSource: input.priceSource,
    candleSource: input.candleSource,
    fallbackDepth,
    dataFreshnessMs,
    missingBarCount,
    lastSuccessfulProvider: input.lastSuccessfulProvider ?? input.priceSource ?? input.candleSource,
    quoteIntegrity,
    universeMembershipConfidence,
    dataTrustScore: clampSignalScore(baseScore),
  };
}

export function buildFxSnapshotDataTrust(input: {
  marketData: PairMarketDataDiagnostics | null;
  snapshotTimestamp: number;
  snapshotQualityConfidence: number;
}): SignalDataTrust {
  const freshness = input.marketData?.lastCandleTimestamp == null
    ? null
    : Math.max(0, input.snapshotTimestamp - input.marketData.lastCandleTimestamp);
  const providerStatus = deriveProviderStatusFromDiagnostics(input.marketData, freshness ?? Number.MAX_SAFE_INTEGER);
  const missingBarCount = input.marketData?.qualityFlag === "missing_bars" ? 1 : 0;
  const quoteIntegrity = providerStatus !== "broken"
    && input.marketData?.qualityFlag !== "duplicate_bars"
    && input.marketData?.qualityFlag !== "out_of_order";

  return buildDataTrust({
    assetClass: "fx",
    providerStatus,
    priceSource: input.marketData?.provider ?? null,
    candleSource: input.marketData?.provider ?? null,
    fallbackDepth: input.marketData?.usedFallback ? 1 : input.marketData?.sourceMode === "cache" ? 1 : 0,
    dataFreshnessMs: freshness,
    missingBarCount,
    lastSuccessfulProvider: input.marketData?.provider ?? null,
    quoteIntegrity,
    universeMembershipConfidence: input.snapshotQualityConfidence,
  });
}

export function buildQualityScores(input: {
  structure: number;
  market: number;
  execution: number;
  data: number;
  assetFit: number;
}): SignalQualityScores {
  const structure = normalizePercentScore(input.structure);
  const market = normalizePercentScore(input.market);
  const execution = normalizePercentScore(input.execution);
  const data = normalizePercentScore(input.data);
  const assetFit = normalizePercentScore(input.assetFit);
  const composite = clampSignalScore(
    structure * 0.28
    + market * 0.2
    + execution * 0.2
    + data * 0.2
    + assetFit * 0.12,
  );

  return {
    structure,
    market,
    execution,
    data,
    assetFit,
    composite,
  };
}

export function buildPublicationState(input: {
  providerStatus: ProviderStatus;
  livePrice: number | null;
  quoteIntegrity: boolean;
  dataTrustScore: number;
  qualityScores: SignalQualityScores | null | undefined;
  noTradeReason?: string | null;
  riskStatus?: "approved" | "rejected" | "deferred" | "reduced";
  blockedReasons?: string[];
  assetPolicyBlocked?: boolean;
  forceWatchlist?: boolean;
  minimumComposite?: number;
  minimumDataTrust?: number;
}): SignalPublicationState {
  const reasons = new Set<SignalRejectionReasonCode>();
  const minimumComposite = input.minimumComposite ?? 56;
  const minimumDataTrust = input.minimumDataTrust ?? 40;

  if (input.livePrice == null) {
    reasons.add("NULL_PRICE");
  }
  if (!input.quoteIntegrity) {
    reasons.add("QUOTE_INTEGRITY_FAILED");
  }
  if (input.providerStatus === "broken") {
    reasons.add("BROKEN_MARKET_DATA");
  }
  if (input.providerStatus === "stale") {
    reasons.add("STALE_CANDLES");
  }
  if (input.providerStatus === "fallback") {
    reasons.add("FALLBACK_PROVIDER");
  }
  if (input.providerStatus === "degraded") {
    reasons.add("PROVIDER_DEGRADED");
  }
  if (input.dataTrustScore < minimumDataTrust) {
    reasons.add("DATA_TRUST_BELOW_FLOOR");
  }
  if (input.assetPolicyBlocked) {
    reasons.add("ASSET_POLICY_REJECT");
  }
  if (input.riskStatus === "rejected") {
    reasons.add("PUBLICATION_POLICY_BLOCK");
  }
  if ((input.blockedReasons ?? []).length > 0 && input.riskStatus === "rejected") {
    reasons.add("PUBLICATION_POLICY_BLOCK");
  }

  const noTradeReason = input.noTradeReason?.toLowerCase() ?? null;
  if (noTradeReason === "market closed") {
    reasons.add("MARKET_CLOSED");
  }
  if (noTradeReason === "low confidence" || noTradeReason === "below confidence threshold") {
    reasons.add("LOW_CONFIDENCE");
  }
  if (noTradeReason === "no structure" || noTradeReason === "no signal") {
    reasons.add("NO_STRUCTURE");
  }

  const qualityComposite = input.qualityScores?.composite ?? 0;

  let status: PublicationStatus;
  if (
    reasons.has("BROKEN_MARKET_DATA")
    || reasons.has("NULL_PRICE")
    || reasons.has("QUOTE_INTEGRITY_FAILED")
    || reasons.has("DATA_TRUST_BELOW_FLOOR")
    || reasons.has("PUBLICATION_POLICY_BLOCK")
    || reasons.has("ASSET_POLICY_REJECT")
  ) {
    status = "blocked";
  } else if (input.forceWatchlist || reasons.has("MARKET_CLOSED")) {
    status = "watchlist_only";
  } else if (
    reasons.has("FALLBACK_PROVIDER")
    || reasons.has("PROVIDER_DEGRADED")
    || reasons.has("STALE_CANDLES")
  ) {
    status = qualityComposite >= minimumComposite ? "shadow_only" : "watchlist_only";
  } else if (
    reasons.has("LOW_CONFIDENCE")
    || reasons.has("NO_STRUCTURE")
    || qualityComposite < minimumComposite
    || input.riskStatus === "deferred"
  ) {
    status = "watchlist_only";
  } else {
    status = "publishable";
  }

  return {
    status,
    reasons: [...reasons],
    health: toModuleHealthState(status, input.providerStatus),
  };
}

export function buildHealthFlags(input: {
  providerStatus: ProviderStatus;
  publicationStatus: PublicationStatus;
  dataTrustScore: number;
  reasons: SignalRejectionReasonCode[];
}): string[] {
  const flags = new Set<string>();
  if (input.providerStatus !== "healthy") {
    flags.add(input.providerStatus.toUpperCase());
  }
  if (input.publicationStatus !== "publishable") {
    flags.add(input.publicationStatus.replaceAll("_", " ").toUpperCase());
  }
  if (input.dataTrustScore < 70) {
    flags.add("LOW TRUST");
  }
  for (const reason of input.reasons) {
    flags.add(reason.replaceAll("_", " "));
  }
  return [...flags];
}

export function summarizeStageDiagnostics(input: {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  symbolsProcessed: string[];
  snapshots: Array<{
    asset_class?: SignalAssetClass;
    provider_status?: ProviderStatus;
    data_trust_score?: number;
    quote_integrity?: boolean;
  }>;
  candidates: Array<{
    publication_status?: PublicationStatus;
    publication_reasons?: SignalRejectionReasonCode[];
  }>;
  riskResults: Array<{
    decision: string;
    publication_status?: PublicationStatus;
    publication_reasons?: SignalRejectionReasonCode[];
  }>;
  signals: Array<{
    publication_status?: PublicationStatus;
  }>;
  viewModels: Array<{
    assetClass?: SignalAssetClass;
    providerStatus?: ProviderStatus;
    publicationStatus?: PublicationStatus;
    publicationReasons?: SignalRejectionReasonCode[];
    dataTrustScore?: number | null;
  }>;
}): Record<string, unknown> {
  const providerCounts = new Map<string, number>();
  const rejectionCounts = new Map<string, number>();
  const assetCounts = new Map<string, number>();

  for (const snapshot of input.snapshots) {
    const providerKey = snapshot.provider_status ?? "unknown";
    providerCounts.set(providerKey, (providerCounts.get(providerKey) ?? 0) + 1);
    const assetKey = snapshot.asset_class ?? "fx";
    assetCounts.set(assetKey, (assetCounts.get(assetKey) ?? 0) + 1);
  }

  for (const record of [...input.candidates, ...input.riskResults]) {
    const reasons = record.publication_reasons ?? [];
    for (const reason of reasons) {
      rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
    }
  }

  for (const record of input.viewModels) {
    const reasons = record.publicationReasons ?? [];
    for (const reason of reasons) {
      rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1);
    }
  }

  const averageDataTrust = input.viewModels.length === 0
    ? null
    : clampSignalScore(
      input.viewModels.reduce((sum, view) => sum + (view.dataTrustScore ?? 0), 0) / input.viewModels.length,
    );

  return {
    cycleId: input.cycleId,
    durationMs: Math.max(0, input.completedAt - input.startedAt),
    stageCounts: {
      marketSnapshotCount: input.snapshots.length,
      tradeCandidateCount: input.candidates.length,
      riskEvaluatedCandidateCount: input.riskResults.length,
      executableSignalCount: input.signals.length,
      publishedCount: input.viewModels.filter(view => view.publicationStatus === "publishable").length,
      lifecycleCount: input.signals.length,
    },
    operationalQuality: {
      zeroSnapshotCycle: input.snapshots.length === 0,
      zeroCandidateCycle: input.candidates.length === 0,
      zeroCardCycle: input.viewModels.length === 0,
      brokenPriceRows: input.viewModels.filter(view => view.publicationReasons?.includes("NULL_PRICE")).length,
      fallbackProviderUsage: input.viewModels.filter(view => view.providerStatus === "fallback").length,
      degradedProviderUsage: input.viewModels.filter(view => view.providerStatus === "degraded" || view.providerStatus === "stale").length,
      averageDataTrustScore: averageDataTrust,
    },
    assetBreakdown: Object.fromEntries(assetCounts),
    providerBreakdown: Object.fromEntries(providerCounts),
    rejectionReasonBreakdown: Object.fromEntries(rejectionCounts),
    processedSymbols: [...input.symbolsProcessed],
  };
}
