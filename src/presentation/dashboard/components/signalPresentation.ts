import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import { publicationStatusPriority, providerStatusPriority } from "@/src/domain/models/signalHealth";
import { formatTraderPrice } from "@/src/lib/trader";

type SignalUiSections = {
  assetClass?: string;
  displayName?: string;
  categoryLabel?: string;
  priceFormat?: string;
  badges?: string[];
};

function readUiSections(signal: SignalViewModel): SignalUiSections {
  return (signal.ui_sections ?? {}) as SignalUiSections;
}

export function getAssetClassLabel(signal: SignalViewModel): string {
  const assetClass = readUiSections(signal).assetClass;
  if (assetClass === "crypto") return "CRYPTO";
  if (assetClass === "stock") return "STOCK";
  if (assetClass === "commodity") return "COMMODITY";
  if (assetClass === "index") return "INDEX";
  if (assetClass === "memecoin") return "MEME";
  return "FX";
}

export function getSignalDisplayName(signal: SignalViewModel): string | null {
  const displayName = readUiSections(signal).displayName?.trim();
  if (!displayName || displayName === signal.symbol) {
    return null;
  }
  return displayName;
}

export function getSignalCategoryLabel(signal: SignalViewModel): string | null {
  return readUiSections(signal).categoryLabel ?? null;
}

export function getSignalBadges(signal: SignalViewModel): string[] {
  return readUiSections(signal).badges ?? [];
}

export function getProviderStatusLabel(signal: SignalViewModel): string | null {
  if (signal.providerStatus === "degraded") return "DEGRADED DATA";
  if (signal.providerStatus === "fallback") return "FALLBACK DATA";
  if (signal.providerStatus === "stale") return "STALE DATA";
  if (signal.providerStatus === "broken") return "BROKEN DATA";
  return null;
}

export function getPublicationStatusLabel(signal: SignalViewModel): string | null {
  if (signal.publicationStatus === "watchlist_only") return "WATCHLIST ONLY";
  if (signal.publicationStatus === "shadow_only") return "SHADOW ONLY";
  if (signal.publicationStatus === "blocked") return "BLOCKED";
  if (signal.publicationStatus === "publishable") return "PUBLISHABLE";
  return null;
}

export function getSignalHealthBadges(signal: SignalViewModel): string[] {
  const badges = [
    getPublicationStatusLabel(signal),
    getProviderStatusLabel(signal),
    ...(signal.healthFlags ?? []).slice(0, 2),
    ...getSignalBadges(signal),
  ].filter((badge): badge is string => Boolean(badge));

  return Array.from(new Set(badges));
}

export function getSignalTrustRank(signal: SignalViewModel): number {
  const publicationRank = publicationStatusPriority(signal.publicationStatus);
  const providerRank = providerStatusPriority(signal.providerStatus);
  const dataTrust = signal.dataTrustScore ?? 0;
  const qualityComposite = signal.qualityScores?.composite ?? signal.gradeScore ?? 0;

  return publicationRank * 1_000_000
    + providerRank * 100_000
    + dataTrust * 100
    + qualityComposite;
}

export function formatSignalPrice(signal: SignalViewModel, value: number | null): string {
  if (value == null) {
    return "n/a";
  }

  if (readUiSections(signal).priceFormat === "fixed_2") {
    return value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  if (readUiSections(signal).priceFormat === "meme") {
    if (value >= 1000) {
      return value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    if (value >= 1) {
      return value.toFixed(4);
    }
    if (value >= 0.001) {
      return value.toFixed(6);
    }
    return value.toExponential(4);
  }

  return formatTraderPrice(value);
}
