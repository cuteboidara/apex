import { providerRegistry } from "@/lib/marketData/providerRegistry";
import { getProviderHealthScore } from "@/lib/marketData/providerHealthEngine";
import type { AssetClass, ProviderSelection } from "@/lib/marketData/types";

export async function selectProviders(assetClass: AssetClass): Promise<ProviderSelection> {
  const candidates = providerRegistry[assetClass];
  const scored = await Promise.all(
    candidates.map(async adapter => ({
      adapter,
      health: await getProviderHealthScore(adapter.provider, assetClass),
    }))
  );

  scored.sort((a, b) => {
    const aPenalty = a.health.circuitState === "OPEN" ? 1000 : a.health.circuitState === "HALF_OPEN" ? 100 : 0;
    const bPenalty = b.health.circuitState === "OPEN" ? 1000 : b.health.circuitState === "HALF_OPEN" ? 100 : 0;
    return (b.health.score - bPenalty) - (a.health.score - aPenalty);
  });

  return {
    primary: scored[0]?.adapter ?? null,
    fallbacks: scored.slice(1).map(item => item.adapter),
  };
}
