import { prisma } from "@/lib/prisma";
import { providerRegistry } from "@/lib/marketData/providerRegistry";
import { getProviderHealthScore } from "@/lib/marketData/providerHealthEngine";
import type { AssetClass } from "@/lib/marketData/types";

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

export async function getProviderSummaries(): Promise<ProviderSummary[]> {
  const keys = Array.from(
    new Set(
      Object.entries(providerRegistry).flatMap(([assetClass, adapters]) =>
        adapters.map(adapter => `${adapter.provider}::${assetClass}`)
      )
    )
  );

  return Promise.all(keys.map(async key => {
    const [provider, assetClass] = key.split("::") as [string, AssetClass];
    const [health, latest] = await Promise.all([
      getProviderHealthScore(provider as never, assetClass),
      prisma.providerHealth.findFirst({
        where: { provider },
        orderBy: { recordedAt: "desc" },
      }).catch(() => null),
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
