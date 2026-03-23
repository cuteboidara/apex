import { getProviderHealthScore, updateCircuitState } from "@/lib/marketData/providerHealthEngine";

export { getProviderHealthScore, updateCircuitState };

export async function getProviderReliabilitySummary(provider: Parameters<typeof getProviderHealthScore>[0], assetClass: Parameters<typeof getProviderHealthScore>[1]) {
  const health = await getProviderHealthScore(provider, assetClass);
  return {
    provider,
    assetClass,
    score: health.score,
    state: health.state,
    circuitState: health.circuitState,
    cooldownUntil: health.cooldownUntil,
  };
}
