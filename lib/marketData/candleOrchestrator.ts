import { prisma } from "@/lib/prisma";
import { getCachedCandles, setCachedCandles } from "@/lib/marketData/cache/marketCache";
import { getProviderHealthScore, updateCircuitState } from "@/lib/marketData/providerHealthEngine";
import { selectProviders } from "@/lib/marketData/providerSelector";
import { shouldUseFallback } from "@/lib/marketData/policies/fallbackPolicy";
import { getCandleFreshnessMs, isCandleFresh } from "@/lib/marketData/policies/freshnessPolicy";
import { chooseBetter } from "@/lib/marketData/policies/quorumPolicy";
import type { AssetClass, OrchestratedCandles, Timeframe } from "@/lib/marketData/types";

function cacheKey(assetClass: AssetClass, symbol: string, timeframe: Timeframe) {
  return `${assetClass}:${symbol}:candles:${timeframe}`;
}

async function persistSnapshot(result: OrchestratedCandles) {
  try {
    const latest = result.candles.at(-1) ?? null;
    await prisma.marketDataSnapshot.create({
      data: {
        symbol: result.symbol,
        assetClass: result.assetClass,
        timeframe: result.timeframe,
        provider: result.selectedProvider ?? result.provider,
        selected: true,
        fallbackUsed: result.fallbackUsed,
        open: latest?.open,
        high: latest?.high,
        low: latest?.low,
        close: latest?.close,
        volume: latest?.volume,
        freshnessMs: result.freshnessMs,
        marketStatus: result.marketStatus,
        reason: result.reason,
      },
    });
  } catch {
    // snapshot persistence must not break reads
  }
}

export async function orchestrateCandles(symbol: string, assetClass: AssetClass, timeframe: Timeframe): Promise<OrchestratedCandles> {
  const cached = getCachedCandles(cacheKey(assetClass, symbol, timeframe));
  const { primary, fallbacks } = await selectProviders(assetClass);

  if (!primary) {
    return {
      symbol,
      assetClass,
      timeframe,
      provider: "Alpha Vantage",
      selectedProvider: null,
      fallbackUsed: false,
      candles: cached?.candles ?? [],
      timestamp: cached?.timestamp ?? null,
      freshnessMs: cached?.freshnessMs ?? null,
      stale: true,
      marketStatus: cached ? "DEGRADED" : "UNAVAILABLE",
      reason: cached ? "Using last-known-good candle cache because no provider is registered." : "No provider registered.",
      fromCache: Boolean(cached),
      circuitState: null,
    };
  }

  const primaryHealth = await getProviderHealthScore(primary.provider, assetClass);
  const primaryResult = await primary.fetchCandles(symbol, timeframe);
  const primaryFreshness = isCandleFresh(primaryResult);
  await updateCircuitState({ provider: primary.provider, assetClass, success: primaryResult.marketStatus === "LIVE" && primaryFreshness.fresh });

  let best = chooseBetter<OrchestratedCandles>(null, {
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
      const fallbackResult = await fallback.fetchCandles(symbol, timeframe);
      const fallbackFreshness = isCandleFresh(fallbackResult);
      await updateCircuitState({ provider: fallback.provider, assetClass, success: fallbackResult.marketStatus === "LIVE" && fallbackFreshness.fresh });
      best = chooseBetter(best, {
        ...fallbackResult,
        selectedProvider: fallback.provider,
        fallbackUsed: true,
        freshnessMs: fallbackFreshness.freshnessMs,
        fromCache: false,
        circuitState: fallbackHealth.circuitState,
      });
      if (best?.marketStatus === "LIVE" && best.candles.length > 0) break;
    }
  }

  const finalResult = best ?? {
    symbol,
    assetClass,
    timeframe,
    provider: primary.provider,
    selectedProvider: primary.provider,
    fallbackUsed: false,
    candles: [],
    timestamp: null,
    freshnessMs: null,
    stale: true,
    marketStatus: "UNAVAILABLE" as const,
    reason: "No candles could be resolved.",
    fromCache: false,
    circuitState: primaryHealth.circuitState,
  };

  if (finalResult.marketStatus === "LIVE" && finalResult.candles.length > 0) {
    setCachedCandles(cacheKey(assetClass, symbol, timeframe), getCandleFreshnessMs(timeframe), finalResult);
    await persistSnapshot(finalResult);
    return finalResult;
  }

  if (cached) {
    const degraded: OrchestratedCandles = {
      ...cached,
      marketStatus: "DEGRADED",
      reason: finalResult.reason ?? "Using last-known-good candle cache.",
      fromCache: true,
    };
    await persistSnapshot(degraded);
    return degraded;
  }

  await persistSnapshot(finalResult);
  return finalResult;
}
