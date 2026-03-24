import { prisma } from "@/lib/prisma";
import { getProviderHealthScore } from "@/lib/marketData/providerHealthEngine";
import { marketProviderCatalog } from "@/lib/marketData/providerRegistry";
import { symbolMatchesAssetClass } from "@/lib/marketData/providerSymbolScope";
import type { AssetClass, ProviderName } from "@/lib/marketData/types";

type ProviderSummary = {
  provider: string;
  assetClass: AssetClass;
  score: number;
  healthState: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
  cooldownUntil: string | null;
  status: string;
  detail: string;
  latencyMs: number | null;
  recordedAt: string | null;
};

const DASHBOARD_MARKET_PROVIDERS = [
  { provider: "Binance", assetClass: "CRYPTO" },
  { provider: "Yahoo Finance", assetClass: "FOREX" },
  { provider: "Yahoo Finance", assetClass: "COMMODITY" },
] as const satisfies ReadonlyArray<{ provider: ProviderName; assetClass: AssetClass }>;

const DASHBOARD_PROVIDER_SCOPE: Array<{ provider: ProviderName; assetClass: AssetClass }> = [...DASHBOARD_MARKET_PROVIDERS].filter(item =>
  marketProviderCatalog.some(adapter =>
    adapter.provider === item.provider &&
    adapter.capability.assetClasses.includes(item.assetClass)
  )
);

function fallbackStatusFromHealth(state: "HEALTHY" | "DEGRADED" | "UNHEALTHY") {
  if (state === "HEALTHY") return "available";
  if (state === "DEGRADED") return "degraded";
  return "offline";
}

export async function getProviderSummaries(): Promise<ProviderSummary[]> {
  type ProviderHealthRecord = Awaited<ReturnType<typeof prisma.providerHealth.findMany>>[number];
  return Promise.all(DASHBOARD_PROVIDER_SCOPE.map(async ({ provider, assetClass }) => {
    const [health, latest] = await Promise.all([
      getProviderHealthScore(provider, assetClass),
      prisma.providerHealth.findMany({
        where: { provider },
        orderBy: { recordedAt: "desc" },
        take: 40,
      }).then(rows => {
        const matching = rows.find((row: ProviderHealthRecord) => symbolMatchesAssetClass(row.requestSymbol, assetClass));
        if (matching) {
          return matching;
        }

        // Binance quote health is sometimes recorded without a requestSymbol in the
        // direct dashboard fetch path, so fall back to the provider-level row.
        return rows.find((row: ProviderHealthRecord) => row.requestSymbol == null) ?? null;
      }).catch(() => null as ProviderHealthRecord | null),
    ]);

    return {
      provider,
      assetClass,
      score: health.score,
      healthState: health.state,
      circuitState: health.circuitState,
      cooldownUntil: health.cooldownUntil,
      status: latest?.status?.toLowerCase?.() ?? fallbackStatusFromHealth(health.state),
      detail: latest?.detail
        ? `${latest.requestSymbol ? `${latest.requestSymbol} · ` : ""}${latest.detail}`
        : provider === "Binance"
          ? "Primary crypto provider"
          : `Primary ${assetClass.toLowerCase()} provider`,
      latencyMs: latest?.latencyMs ?? null,
      recordedAt: latest?.recordedAt?.toISOString?.() ?? null,
    };
  }));
}
