export const PROVIDER_STATUS_VALUES = [
  "healthy",
  "degraded",
  "fallback",
  "stale",
  "broken",
] as const;

export const PUBLICATION_STATUS_VALUES = [
  "publishable",
  "watchlist_only",
  "shadow_only",
  "blocked",
] as const;

export const SIGNAL_ASSET_CLASS_VALUES = [
  "fx",
  "crypto",
  "stock",
  "commodity",
  "index",
  "memecoin",
] as const;

export const SIGNAL_REJECTION_REASON_VALUES = [
  "NULL_PRICE",
  "STALE_CANDLES",
  "FALLBACK_PROVIDER",
  "LOW_LIQUIDITY",
  "WEAK_EXECUTION_QUALITY",
  "ASSET_POLICY_REJECT",
  "BROKEN_MARKET_DATA",
  "UNIVERSE_EMPTY",
  "TRIGGER_GENERATED_NO_CARD",
  "MARKET_CLOSED",
  "LOW_CONFIDENCE",
  "NO_STRUCTURE",
  "PROVIDER_DEGRADED",
  "QUOTE_INTEGRITY_FAILED",
  "DATA_TRUST_BELOW_FLOOR",
  "PUBLICATION_POLICY_BLOCK",
] as const;

export type ProviderStatus = typeof PROVIDER_STATUS_VALUES[number];
export type PublicationStatus = typeof PUBLICATION_STATUS_VALUES[number];
export type SignalAssetClass = typeof SIGNAL_ASSET_CLASS_VALUES[number];
export type SignalRejectionReasonCode = typeof SIGNAL_REJECTION_REASON_VALUES[number];
export type ModuleHealthState = "working" | "degraded" | "broken" | "blocked_from_publication";

export type SignalQualityScores = {
  structure: number;
  market: number;
  execution: number;
  data: number;
  assetFit: number;
  composite: number;
};

export type SignalDataTrust = {
  assetClass: SignalAssetClass;
  providerStatus: ProviderStatus;
  priceSource: string | null;
  candleSource: string | null;
  fallbackDepth: number;
  dataFreshnessMs: number | null;
  missingBarCount: number;
  lastSuccessfulProvider: string | null;
  quoteIntegrity: boolean;
  universeMembershipConfidence: number;
  dataTrustScore: number;
};

export type SignalPublicationState = {
  status: PublicationStatus;
  reasons: SignalRejectionReasonCode[];
  health: ModuleHealthState;
};

export function clampSignalScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function toModuleHealthState(status: PublicationStatus, providerStatus: ProviderStatus): ModuleHealthState {
  if (status === "blocked") {
    return providerStatus === "broken" ? "broken" : "blocked_from_publication";
  }
  if (providerStatus === "healthy") {
    return "working";
  }
  return "degraded";
}

export function providerStatusPriority(status: ProviderStatus | null | undefined): number {
  switch (status) {
    case "healthy":
      return 4;
    case "degraded":
      return 3;
    case "fallback":
      return 2;
    case "stale":
      return 1;
    case "broken":
      return 0;
    default:
      return -1;
  }
}

export function publicationStatusPriority(status: PublicationStatus | null | undefined): number {
  switch (status) {
    case "publishable":
      return 3;
    case "watchlist_only":
      return 2;
    case "shadow_only":
      return 1;
    case "blocked":
      return 0;
    default:
      return -1;
  }
}
