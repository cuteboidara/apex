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

const DASHBOARD_MARKET_PROVIDERS: Array<{ provider: ProviderName; assetClass: AssetClass }> = Array.from(
  new Map(
    marketProviderCatalog.flatMap(adapter =>
      adapter.capability.assetClasses.map(assetClass => [
        `${adapter.provider}:${assetClass}`,
        { provider: adapter.provider, assetClass },
      ] as const)
    )
  ).values()
);

export async function getProviderSummaries(): Promise<ProviderSummary[]> {
  type ProviderHealthRecord = Awaited<ReturnType<typeof prisma.providerHealth.findMany>>[number];
  return Promise.all(DASHBOARD_MARKET_PROVIDERS.map(async ({ provider, assetClass }) => {
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
      status: latest?.status?.toLowerCase?.() ?? health.state.toLowerCase(),
      detail: latest?.detail
        ? `${latest.requestSymbol ? `${latest.requestSymbol} · ` : ""}${latest.detail}`
        : `${assetClass.toLowerCase()} provider`,
      latencyMs: latest?.latencyMs ?? null,
      recordedAt: latest?.recordedAt?.toISOString?.() ?? null,
    };
  }));
}
