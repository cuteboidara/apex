import { prisma } from "@/lib/prisma";
import { getCachedQuote, setCachedQuote } from "@/lib/marketData/cache/marketCache";
import { getProviderHealthScore, updateCircuitState } from "@/lib/marketData/providerHealthEngine";
import { selectProviders } from "@/lib/marketData/providerSelector";
import { shouldUseFallback } from "@/lib/marketData/policies/fallbackPolicy";
import { isQuoteFresh, getQuoteFreshnessMs } from "@/lib/marketData/policies/freshnessPolicy";
import { chooseBetter } from "@/lib/marketData/policies/quorumPolicy";
import type { AssetClass, OrchestratedQuote } from "@/lib/marketData/types";

function cacheKey(assetClass: AssetClass, symbol: string) {
  return `${assetClass}:${symbol}:quote`;
}

async function persistSnapshot(result: OrchestratedQuote) {
  try {
    await prisma.marketDataSnapshot.create({
      data: {
        symbol: result.symbol,
        assetClass: result.assetClass,
        timeframe: "quote",
        provider: result.selectedProvider ?? result.provider,
        selected: true,
        fallbackUsed: result.fallbackUsed,
        price: result.price,
        freshnessMs: result.freshnessMs,
        marketStatus: result.marketStatus,
        reason: result.reason,
      },
    });
  } catch {
    // snapshot persistence must not break reads
  }
}

export async function orchestrateQuote(symbol: string, assetClass: AssetClass): Promise<OrchestratedQuote> {
  const cached = getCachedQuote(cacheKey(assetClass, symbol));
  const { primary, fallbacks } = await selectProviders(assetClass);

  if (!primary) {
    return {
      symbol,
      assetClass,
      provider: "Alpha Vantage",
      selectedProvider: null,
      fallbackUsed: false,
      price: cached?.price ?? null,
      change24h: cached?.change24h ?? null,
      high14d: cached?.high14d ?? null,
      low14d: cached?.low14d ?? null,
      volume: cached?.volume ?? null,
      timestamp: cached?.timestamp ?? null,
      freshnessMs: cached?.freshnessMs ?? null,
      stale: true,
      marketStatus: cached ? "DEGRADED" : "UNAVAILABLE",
      reason: cached ? "Using last-known-good cache because no provider is registered." : "No provider registered.",
      fromCache: Boolean(cached),
      circuitState: null,
      closes: cached?.closes,
    };
  }

  const primaryHealth = await getProviderHealthScore(primary.provider, assetClass);
  const primaryResult = await primary.fetchQuote(symbol);
  const primaryFreshness = isQuoteFresh(primaryResult);
  await updateCircuitState({ provider: primary.provider, assetClass, success: primaryResult.marketStatus === "LIVE" && primaryFreshness.fresh });

  let best = chooseBetter<OrchestratedQuote>(null, {
    ...primaryResult,
    selectedProvider: primary.provider,
    fallbackUsed: false,
    freshnessMs: primaryFreshness.freshnessMs,
    fromCache: false,
    circuitState: primaryHealth.circuitState,
  });

  if (shouldUseFallback({
    primaryHealthy: primaryHealth.state !== "UNHEALTHY",
    primaryFresh: primaryFreshness.fresh,
    primaryStatus: primaryResult.marketStatus,
    circuitOpen: primaryHealth.circuitState === "OPEN",
  })) {
    for (const fallback of fallbacks) {
      const fallbackHealth = await getProviderHealthScore(fallback.provider, assetClass);
      const fallbackResult = await fallback.fetchQuote(symbol);
      const fallbackFreshness = isQuoteFresh(fallbackResult);
      await updateCircuitState({ provider: fallback.provider, assetClass, success: fallbackResult.marketStatus === "LIVE" && fallbackFreshness.fresh });
      best = chooseBetter(best, {
        ...fallbackResult,
        selectedProvider: fallback.provider,
        fallbackUsed: true,
        freshnessMs: fallbackFreshness.freshnessMs,
        fromCache: false,
        circuitState: fallbackHealth.circuitState,
      });
      if (best?.marketStatus === "LIVE" && best.price != null && best.price > 0) break;
    }
  }

  const finalResult = best ?? {
    symbol,
    assetClass,
    provider: primary.provider,
    selectedProvider: primary.provider,
    fallbackUsed: false,
    price: null,
    change24h: null,
    high14d: null,
    low14d: null,
    volume: null,
    timestamp: null,
    freshnessMs: null,
    stale: true,
    marketStatus: "UNAVAILABLE" as const,
    reason: "No quote could be resolved.",
    fromCache: false,
    circuitState: primaryHealth.circuitState,
    closes: [],
  };

  if (finalResult.marketStatus === "LIVE" && finalResult.price != null && finalResult.price > 0) {
    setCachedQuote(cacheKey(assetClass, symbol), getQuoteFreshnessMs(assetClass), finalResult);
    await persistSnapshot(finalResult);
    return finalResult;
  }

  if (cached) {
    const degraded: OrchestratedQuote = {
      ...cached,
      marketStatus: "DEGRADED",
      reason: finalResult.reason ?? "Using last-known-good cache.",
      fromCache: true,
    };
    await persistSnapshot(degraded);
    return degraded;
  }

  await persistSnapshot(finalResult);
  return finalResult;
}
