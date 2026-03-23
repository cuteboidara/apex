import { getCachedValue, setCachedValue } from "@/lib/runtime/runtimeCache";
import { getProviderAdaptersForAsset } from "@/lib/marketData/providerRegistry";
import { persistHistoricalCandles } from "@/lib/marketData/persistence";
import { getProviderHealthScore, updateCircuitState } from "@/lib/marketData/providerHealth";
import { classifyFreshness, getCandleStalenessWindowMs } from "@/lib/marketData/staleness";
import type { AssetClass, MarketStatus, Timeframe } from "@/lib/marketData/types";
import type { RoutedMarketCandles } from "@/lib/providers/types";

function buildCacheKey(symbol: string, assetClass: AssetClass, timeframe: Timeframe) {
  return `market:candles:v2:${assetClass}:${symbol}:${timeframe}`;
}

function scoreCandles(result: RoutedMarketCandles) {
  let score = 0;
  if (result.candles.length > 0) score += 50;
  if (result.marketStatus === "LIVE") score += 40;
  if (result.freshnessClass === "fresh") score += 20;
  if (result.freshnessClass === "stale") score += 10;
  if (result.fallbackUsed) score -= 5;
  if (result.providerHealthScore != null) score += Math.round(result.providerHealthScore / 10);
  return score;
}

function toMarketStatus(input: {
  marketStatus: MarketStatus;
  freshnessClass: RoutedMarketCandles["freshnessClass"];
  candles: RoutedMarketCandles["candles"];
}) {
  if (input.candles.length === 0) return "UNAVAILABLE" as const;
  if (input.marketStatus !== "LIVE") return input.marketStatus;
  return input.freshnessClass === "fresh" ? "LIVE" as const : "DEGRADED" as const;
}

export async function fetchMarketCandles(
  symbol: string,
  assetClass: AssetClass,
  timeframe: Timeframe
): Promise<RoutedMarketCandles> {
  const cacheKey = buildCacheKey(symbol, assetClass, timeframe);
  const cached = await getCachedValue<RoutedMarketCandles>(cacheKey);
  if (cached && cached.candles.length > 0 && cached.marketStatus !== "UNAVAILABLE") {
    return {
      ...cached,
      fromCache: true,
      sourceType: cached.sourceType === "fresh" ? "cache" : cached.sourceType,
    };
  }

  const providers = getProviderAdaptersForAsset(assetClass, timeframe);
  let best: RoutedMarketCandles | null = null;

  for (const [index, provider] of providers.entries()) {
    const health = await getProviderHealthScore(provider.provider, assetClass);
    const shouldSkip = health.circuitState === "OPEN" && index < providers.length - 1;
    if (shouldSkip) {
      continue;
    }

    const raw = await provider.fetchCandles(symbol, assetClass, timeframe);
    const freshness = classifyFreshness(raw.timestamp, getCandleStalenessWindowMs(timeframe));
    const marketStatus = toMarketStatus({
      marketStatus: raw.marketStatus,
      freshnessClass: freshness.freshnessClass,
      candles: raw.candles,
    });

    await updateCircuitState({
      provider: provider.provider,
      assetClass,
      success: marketStatus === "LIVE",
      detail: raw.reason,
    });

    const result: RoutedMarketCandles = {
      ...raw,
      selectedProvider: provider.provider,
      fallbackUsed: index > 0,
      freshnessMs: freshness.freshnessMs,
      fromCache: false,
      circuitState: health.circuitState,
      providerHealthScore: health.score,
      degraded: marketStatus !== "LIVE" || index > 0 || freshness.freshnessClass !== "fresh",
      sourceType: "fresh",
      freshnessClass: freshness.freshnessClass,
      fetchedAt: Date.now(),
      cacheKey,
      priority: "warm",
      stale: raw.stale || freshness.freshnessClass !== "fresh" || marketStatus !== "LIVE",
      marketStatus,
      reason: raw.reason ?? (marketStatus === "LIVE" ? null : `${provider.provider} candles unavailable.`),
      requestSymbol: raw.requestSymbol ?? symbol,
      metadata: raw.metadata ?? null,
    };

    if (result.candles.length > 0) {
      await persistHistoricalCandles(symbol, assetClass, timeframe, raw, {
        selectedProvider: provider.provider,
      });
      await setCachedValue(cacheKey, result, freshness.freshnessClass === "fresh" ? 60_000 : 15_000);
    }

    if (!best || scoreCandles(result) > scoreCandles(best)) {
      best = result;
    }

    if (result.marketStatus === "LIVE" && result.freshnessClass === "fresh" && result.candles.length > 0) {
      return result;
    }
  }

  if (best) {
    return best;
  }

  return {
    symbol,
    assetClass,
    provider: assetClass === "CRYPTO" ? "Binance" : "Yahoo Finance",
    selectedProvider: null,
    timeframe,
    candles: [],
    timestamp: null,
    stale: true,
    marketStatus: "UNAVAILABLE",
    reason: "No candle providers available.",
    fallbackUsed: false,
    freshnessMs: null,
    fromCache: false,
    circuitState: null,
    providerHealthScore: null,
    degraded: true,
    sourceType: "fallback",
    freshnessClass: "expired",
    fetchedAt: null,
    cacheKey,
    priority: "warm",
    requestSymbol: symbol,
    metadata: null,
  };
}
