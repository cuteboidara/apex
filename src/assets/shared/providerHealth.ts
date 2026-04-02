import type { SignalAssetClass } from "@/src/domain/models/signalHealth";

export type ProviderHealthStateAtSignal = "HEALTHY" | "DEGRADED" | "UNHEALTHY";
export type ProviderMarketStatusAtSignal = "LIVE" | "DEGRADED" | "UNAVAILABLE";
export type OutcomeDataQuality = "healthy" | "fallback" | "degraded" | "manual";

export function mapProviderStatusToSignalHealth(
  providerStatus: string | null | undefined,
): ProviderHealthStateAtSignal {
  const normalized = String(providerStatus ?? "").toLowerCase();
  if (!normalized || normalized === "healthy" || normalized === "ready") {
    return "HEALTHY";
  }
  if (normalized.includes("broken") || normalized.includes("no_data") || normalized.includes("not_authorized")) {
    return "UNHEALTHY";
  }
  return "DEGRADED";
}

export function mapProviderStatusToMarketStatus(
  providerStatus: string | null | undefined,
): ProviderMarketStatusAtSignal {
  const normalized = String(providerStatus ?? "").toLowerCase();
  if (!normalized || normalized === "healthy" || normalized === "ready") {
    return "LIVE";
  }
  if (normalized.includes("broken") || normalized.includes("no_data") || normalized.includes("not_authorized")) {
    return "UNAVAILABLE";
  }
  return "DEGRADED";
}

export function resolveOutcomeDataQuality(input: {
  providerStatus?: string | null;
  fallbackUsed?: boolean;
  manual?: boolean;
}): OutcomeDataQuality {
  if (input.manual) {
    return "manual";
  }

  const normalized = String(input.providerStatus ?? "").toLowerCase();
  if (!normalized || normalized === "healthy" || normalized === "ready") {
    return input.fallbackUsed ? "fallback" : "healthy";
  }
  if (normalized.includes("fallback") || normalized.includes("cached") || input.fallbackUsed) {
    return "fallback";
  }
  return "degraded";
}

export function computeOutcomeAwareProviderScore(input: {
  baseScore: number;
  sampleSize: number;
  averageRealizedR: number | null;
  positiveExpectancyRate: number | null;
}): number {
  if (input.sampleSize <= 0) {
    return input.baseScore;
  }

  const expectancy = Math.max(-2, Math.min(2, input.averageRealizedR ?? 0));
  const expectancyTilt = expectancy * 8;
  const winRateTilt = ((input.positiveExpectancyRate ?? 0.5) - 0.5) * 30;
  const sampleConfidence = Math.min(1, input.sampleSize / 20);
  const adjustment = Math.round((expectancyTilt + winRateTilt) * sampleConfidence);

  return Math.max(0, Math.round(input.baseScore + adjustment));
}

export function preferredProviderWarmupSymbol(assetClass: SignalAssetClass): string | null {
  switch (assetClass) {
    case "stock":
      return "AAPL";
    case "crypto":
      return "BTCUSDT";
    case "memecoin":
      return "DOGEUSDT";
    case "commodity":
      return "XAUUSD";
    case "index":
      return "SPX";
    case "fx":
      return "EURUSD";
    default:
      return null;
  }
}
