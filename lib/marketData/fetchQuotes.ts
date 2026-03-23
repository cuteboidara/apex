import { getCachedValue, setCachedValue } from "@/lib/runtime/runtimeCache";
import { getProviderAdaptersForAsset } from "@/lib/marketData/providerRegistry";
import { persistHistoricalQuote } from "@/lib/marketData/persistence";
import { getProviderHealthScore, updateCircuitState } from "@/lib/marketData/providerHealth";
import { classifyFreshness, getQuoteStalenessWindowMs } from "@/lib/marketData/staleness";
import type { AssetClass, MarketStatus } from "@/lib/marketData/types";
import type { RoutedMarketQuote } from "@/lib/providers/types";

function buildCacheKey(symbol: string, assetClass: AssetClass) {
  return `market:quote:v2:${assetClass}:${symbol}`;
}

function scoreQuote(result: RoutedMarketQuote) {
  let score = 0;
  if (result.price != null && result.price > 0) score += 50;
  if (result.marketStatus === "LIVE") score += 40;
  if (result.freshnessClass === "fresh") score += 20;
  if (result.freshnessClass === "stale") score += 10;
  if (result.fallbackUsed) score -= 5;
  if (result.providerHealthScore != null) score += Math.round(result.providerHealthScore / 10);
  return score;
}

function toMarketStatus(input: {
  marketStatus: MarketStatus;
  freshnessClass: RoutedMarketQuote["freshnessClass"];
  price: number | null;
}) {
  if (input.price == null || input.price <= 0) return "UNAVAILABLE" as const;
  if (input.marketStatus !== "LIVE") return input.marketStatus;
  return input.freshnessClass === "fresh" ? "LIVE" as const : "DEGRADED" as const;
}

export async function fetchMarketQuote(symbol: string, assetClass: AssetClass): Promise<RoutedMarketQuote> {
  const cacheKey = buildCacheKey(symbol, assetClass);
  const cached = await getCachedValue<RoutedMarketQuote>(cacheKey);
  if (cached && cached.price != null && cached.marketStatus !== "UNAVAILABLE") {
    return {
      ...cached,
      fromCache: true,
      sourceType: cached.sourceType === "fresh" ? "cache" : cached.sourceType,
    };
  }

  const providers = getProviderAdaptersForAsset(assetClass);
  let best: RoutedMarketQuote | null = null;

  for (const [index, provider] of providers.entries()) {
    const health = await getProviderHealthScore(provider.provider, assetClass);
    const shouldSkip = health.circuitState === "OPEN" && index < providers.length - 1;
    if (shouldSkip) {
      continue;
    }

    const raw = await provider.fetchQuote(symbol, assetClass);
    const freshness = classifyFreshness(raw.timestamp, getQuoteStalenessWindowMs(assetClass));
    const marketStatus = toMarketStatus({
      marketStatus: raw.marketStatus,
      freshnessClass: freshness.freshnessClass,
      price: raw.price,
    });

    await updateCircuitState({
      provider: provider.provider,
      assetClass,
      success: marketStatus === "LIVE",
      detail: raw.reason,
    });

    const result: RoutedMarketQuote = {
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
      reason: raw.reason ?? (marketStatus === "LIVE" ? null : `${provider.provider} quote unavailable.`),
      requestSymbol: raw.requestSymbol ?? symbol,
      bid: raw.bid ?? null,
      ask: raw.ask ?? null,
      metadata: raw.metadata ?? null,
    };

    if (result.price != null && result.price > 0) {
      await persistHistoricalQuote(symbol, assetClass, raw, {
        selectedProvider: provider.provider,
        freshnessMs: result.freshnessMs,
      });
      await setCachedValue(cacheKey, result, freshness.freshnessClass === "fresh" ? 30_000 : 10_000);
    }

    if (!best || scoreQuote(result) > scoreQuote(best)) {
      best = result;
    }

    if (result.marketStatus === "LIVE" && result.freshnessClass === "fresh" && result.price != null && result.price > 0) {
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
    price: null,
    change24h: null,
    high14d: null,
    low14d: null,
    volume: null,
    timestamp: null,
    stale: true,
    marketStatus: "UNAVAILABLE",
    reason: "No quote providers available.",
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
    bid: null,
    ask: null,
    metadata: null,
  };
}
