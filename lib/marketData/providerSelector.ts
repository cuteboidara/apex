import { providerRegistry } from "@/lib/marketData/providerRegistry";
import { getProviderHealthScore } from "@/lib/marketData/providerHealthEngine";
import type { AssetClass, ProviderSelection } from "@/lib/marketData/types";

export async function selectProviders(assetClass: AssetClass): Promise<ProviderSelection> {
  const candidates = providerRegistry[assetClass];
  const scored = await Promise.all(
    candidates.map(async (adapter, index) => ({
      index,
      adapter,
      health: await getProviderHealthScore(adapter.provider, assetClass),
    }))
  );

  const primaryCandidate =
    scored.find(item => item.health.circuitState !== "OPEN") ??
    scored[0] ??
    null;
  const fallbacks = scored
    .filter(item => item.adapter.provider !== primaryCandidate?.adapter.provider || item.index !== primaryCandidate.index)
    .sort((a, b) => {
      const aPenalty = a.health.circuitState === "OPEN" ? 1 : 0;
      const bPenalty = b.health.circuitState === "OPEN" ? 1 : 0;
      return aPenalty - bPenalty || a.index - b.index;
    });

  return {
    primary: primaryCandidate?.adapter ?? null,
    fallbacks: fallbacks.map(item => item.adapter),
  };
}
