import { prisma } from "@/lib/prisma";
import {
  buildCandleCacheKey,
  getCachedMarketValue,
  peekInflight,
  setCachedMarketValue,
  withInflightDedup,
} from "@/lib/marketData/cache/marketCache";
import { getProviderHealthScore, updateCircuitState } from "@/lib/marketData/providerHealthEngine";
import { selectProviders } from "@/lib/marketData/providerSelector";
import { shouldUseFallback } from "@/lib/marketData/policies/fallbackPolicy";
import { getCandleFreshnessMs, isCandleFresh } from "@/lib/marketData/policies/freshnessPolicy";
import { resolveCandleRequestPolicy, type MarketRequestContext } from "@/lib/marketData/policies/requestPolicy";
import { chooseBetter } from "@/lib/marketData/policies/quorumPolicy";
import type {
  AssetClass,
  CacheSourceType,
  CandleBar,
  CandleResult,
  FreshnessClass,
  MarketRequestPriority,
  MarketStatus,
  OrchestratedCandles,
  ProviderName,
  Timeframe,
} from "@/lib/marketData/types";

function deriveFreshnessMs(result: Pick<CandleResult, "timestamp">, fallbackTimestamp: number | null) {
  const reference = result.timestamp ?? fallbackTimestamp;
  return reference != null ? Math.max(0, Date.now() - reference) : null;
}

function finalizeCandles(
  result: CandleResult,
  input: {
    selectedProvider: ProviderName | null;
    fallbackUsed: boolean;
    fromCache: boolean;
    circuitState: string | null;
    providerHealthScore: number | null;
    sourceType: CacheSourceType;
    freshnessClass: FreshnessClass;
    fetchedAt: number | null;
    cacheKey: string | null;
    priority: MarketRequestPriority;
    reason?: string | null;
    marketStatus?: MarketStatus;
  }
): OrchestratedCandles {
  const freshnessMs = deriveFreshnessMs(result, input.fetchedAt);
  const marketStatus = input.marketStatus ?? (
    input.freshnessClass === "fresh"
      ? result.marketStatus
      : result.marketStatus === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : "DEGRADED"
  );
  const stale = result.stale || input.freshnessClass !== "fresh" || result.candles.length === 0 || marketStatus !== "LIVE";

  return {
    ...result,
    selectedProvider: input.selectedProvider,
    fallbackUsed: input.fallbackUsed,
    freshnessMs,
    fromCache: input.fromCache,
    circuitState: input.circuitState,
    providerHealthScore: input.providerHealthScore,
    degraded: marketStatus !== "LIVE" || input.fallbackUsed || input.freshnessClass !== "fresh",
    sourceType: input.sourceType,
    freshnessClass: input.freshnessClass,
    fetchedAt: input.fetchedAt,
    cacheKey: input.cacheKey,
    priority: input.priority,
    stale,
    marketStatus,
    reason: input.reason ?? result.reason,
  };
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

async function getPersistedCandleFallback(
  symbol: string,
  assetClass: AssetClass,
  timeframe: Timeframe,
  defaultProvider: ProviderName,
  circuitState: string | null,
  priority: MarketRequestPriority
): Promise<OrchestratedCandles | null> {
  type SnapshotRecord = Awaited<ReturnType<typeof prisma.marketDataSnapshot.findMany>>[number];

  const snapshots = await prisma.marketDataSnapshot.findMany({
    where: {
      symbol,
      assetClass,
      timeframe,
    },
    orderBy: { capturedAt: "desc" },
    take: 50,
  }).catch(() => [] as SnapshotRecord[]);

  const candles = snapshots
    .filter((row: SnapshotRecord) => row.capturedAt != null && row.close != null)
    .map((row: SnapshotRecord) => ({
      timestamp: row.capturedAt.getTime(),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }))
    .sort((left: CandleBar, right: CandleBar) => left.timestamp - right.timestamp) as CandleBar[];

  const timestamp = candles.at(-1)?.timestamp ?? null;
  if (candles.length === 0 || timestamp == null) {
    return null;
  }

  return finalizeCandles({
    symbol,
    assetClass,
    timeframe,
    provider: defaultProvider,
    candles,
    timestamp,
    stale: true,
    marketStatus: "DEGRADED",
    reason: "Using persisted candle snapshots because live providers are unavailable.",
  }, {
    selectedProvider: (snapshots[0]?.provider ?? null) as ProviderName | null,
    fallbackUsed: true,
    fromCache: true,
    circuitState,
    providerHealthScore: null,
    sourceType: "fallback",
    freshnessClass: "stale",
    fetchedAt: timestamp,
    cacheKey: null,
    priority,
  });
}

function allowFallbackProvider(provider: ProviderName, input: { allowRareFallback: boolean }) {
  if (provider !== "Alpha Vantage") return true;
  return input.allowRareFallback;
}

async function fetchProviderCandlesWithPolicy(input: {
  symbol: string;
  assetClass: AssetClass;
  timeframe: Timeframe;
  provider: { provider: ProviderName; fetchCandles: (symbol: string, timeframe: Timeframe) => Promise<CandleResult> };
  priority: MarketRequestPriority;
  policy: ReturnType<typeof resolveCandleRequestPolicy>;
  health: Awaited<ReturnType<typeof getProviderHealthScore>>;
}) {
  const cacheKey = buildCandleCacheKey({
    provider: input.provider.provider,
    assetClass: input.assetClass,
    symbol: input.symbol,
    timeframe: input.timeframe,
    bucketMs: input.policy.bucketMs,
    limit: 50,
  });

  const cached = await getCachedMarketValue<CandleResult>(cacheKey);
  if (cached) {
    const cachedResult = finalizeCandles(cached.envelope.value, {
      selectedProvider: input.provider.provider,
      fallbackUsed: false,
      fromCache: true,
      circuitState: input.health.circuitState,
      providerHealthScore: input.health.score,
      sourceType: cached.sourceType,
      freshnessClass: cached.freshnessClass,
      fetchedAt: cached.envelope.fetchedAt,
      cacheKey,
      priority: input.priority,
      reason: cached.freshnessClass === "fresh"
        ? cached.envelope.value.reason
        : cached.envelope.value.reason ?? `Serving stale cached ${input.provider.provider} candles while refresh is pending.`,
    });

    if (cached.freshnessClass === "fresh" || !input.policy.allowStaleWhileRevalidate) {
      return cachedResult;
    }

    if (input.policy.allowBackgroundRefresh && !peekInflight(cacheKey)) {
      void withInflightDedup(cacheKey, async () => {
        await fetchProviderCandlesWithPolicy({
          ...input,
          policy: {
            ...input.policy,
            allowStaleWhileRevalidate: false,
          },
        });
      }).catch(() => null);
    }

    return cachedResult;
  }

  return withInflightDedup(cacheKey, async () => {
    const rawResult = await input.provider.fetchCandles(input.symbol, input.timeframe);
    const freshness = isCandleFresh(rawResult);
    await updateCircuitState({
      provider: input.provider.provider,
      assetClass: input.assetClass,
      success: rawResult.marketStatus === "LIVE" && freshness.fresh,
      detail: rawResult.reason,
    });

    if (rawResult.candles.length > 0) {
      await setCachedMarketValue(cacheKey, rawResult, {
        freshTtlMs: input.policy.freshTtlMs,
        staleTtlMs: input.policy.staleTtlMs,
        provider: input.provider.provider,
        degraded: rawResult.marketStatus !== "LIVE" || !freshness.fresh,
        priority: input.priority,
      });
    }

    return finalizeCandles(rawResult, {
      selectedProvider: input.provider.provider,
      fallbackUsed: false,
      fromCache: false,
      circuitState: input.health.circuitState,
      providerHealthScore: input.health.score,
      sourceType: "fresh",
      freshnessClass: freshness.fresh ? "fresh" : "stale",
      fetchedAt: Date.now(),
      cacheKey,
      priority: input.priority,
      marketStatus: freshness.fresh ? rawResult.marketStatus : rawResult.marketStatus === "UNAVAILABLE" ? "UNAVAILABLE" : "DEGRADED",
    });
  });
}

export async function orchestrateCandles(
  symbol: string,
  assetClass: AssetClass,
  timeframe: Timeframe,
  context?: MarketRequestContext
): Promise<OrchestratedCandles> {
  // FOREX and COMMODITY are served exclusively by Yahoo Finance via fetchMultiProviderAsset —
  // they must never reach the orchestrator (which would try FCS/AlphaVantage).
  if (assetClass === "FOREX" || assetClass === "COMMODITY") {
    console.warn(`[APEX:orchestrator] orchestrateCandles called for ${assetClass} ${symbol} — short-circuiting, Yahoo Finance handles these`);
    const policy = resolveCandleRequestPolicy(timeframe, context);
    return finalizeCandles({
      symbol,
      assetClass,
      timeframe,
      provider: "Yahoo Finance" as ProviderName,
      candles: [],
      timestamp: null,
      stale: true,
      marketStatus: "UNAVAILABLE",
      reason: "FOREX/COMMODITY routed to Yahoo Finance — orchestrator bypassed.",
    }, {
      selectedProvider: null,
      fallbackUsed: false,
      fromCache: false,
      circuitState: null,
      providerHealthScore: null,
      sourceType: "fallback",
      freshnessClass: "expired",
      fetchedAt: null,
      cacheKey: null,
      priority: policy.priority,
    });
  }

  const policy = resolveCandleRequestPolicy(timeframe, context);
  const { primary, fallbacks } = await selectProviders(assetClass);

  if (!primary) {
    return finalizeCandles({
      symbol,
      assetClass,
      timeframe,
      provider: "Alpha Vantage",
      candles: [],
      timestamp: null,
      stale: true,
      marketStatus: "UNAVAILABLE",
      reason: "No provider registered.",
    }, {
      selectedProvider: null,
      fallbackUsed: false,
      fromCache: false,
      circuitState: null,
      providerHealthScore: null,
      sourceType: "fallback",
      freshnessClass: "expired",
      fetchedAt: null,
      cacheKey: null,
      priority: policy.priority,
    });
  }

  const primaryHealth = await getProviderHealthScore(primary.provider, assetClass);
  const primaryResult = await fetchProviderCandlesWithPolicy({
    symbol,
    assetClass,
    timeframe,
    provider: primary,
    priority: policy.priority,
    policy,
    health: primaryHealth,
  });

  let best = primaryResult;

  if (shouldUseFallback({
    primaryHealthy: primaryHealth.state !== "UNHEALTHY",
    primaryFresh: primaryResult.freshnessClass === "fresh",
    primaryStatus: primaryResult.marketStatus,
    circuitOpen: primaryHealth.circuitState === "OPEN",
  })) {
    for (const fallback of fallbacks) {
      if (!allowFallbackProvider(fallback.provider, { allowRareFallback: policy.allowRareFallback })) {
        continue;
      }

      const fallbackHealth = await getProviderHealthScore(fallback.provider, assetClass);
      const fallbackResult = await fetchProviderCandlesWithPolicy({
        symbol,
        assetClass,
        timeframe,
        provider: fallback,
        priority: policy.priority,
        policy,
        health: fallbackHealth,
      });

      best = chooseBetter(best, {
        ...fallbackResult,
        fallbackUsed: fallbackResult.provider !== primary.provider,
        sourceType: fallbackResult.sourceType === "fresh" ? "fallback" : fallbackResult.sourceType,
      });

      if (best.marketStatus === "LIVE" && best.candles.length > 0) {
        break;
      }
    }
  }

  if (best.marketStatus === "LIVE" && best.candles.length > 0) {
    await persistSnapshot(best);
    return best;
  }

  if (best.fromCache && best.candles.length > 0) {
    const degraded = {
      ...best,
      marketStatus: "DEGRADED" as const,
      degraded: true,
      sourceType: best.sourceType === "cache" ? "stale-cache" : best.sourceType,
      freshnessClass: best.freshnessClass === "fresh" ? "stale" : best.freshnessClass,
      reason: best.reason ?? "Using last-known-good candle cache.",
    };
    await persistSnapshot(degraded);
    return degraded;
  }

  const persistedFallback = await getPersistedCandleFallback(
    symbol,
    assetClass,
    timeframe,
    primary.provider,
    primaryHealth.circuitState,
    policy.priority
  );
  if (persistedFallback) {
    await persistSnapshot(persistedFallback);
    return persistedFallback;
  }

  const finalUnavailable = {
    ...best,
    selectedProvider: best.selectedProvider ?? primary.provider,
    provider: best.provider ?? primary.provider,
    marketStatus: "UNAVAILABLE" as const,
    degraded: true,
    stale: true,
    sourceType: best.sourceType === "fresh" ? "fallback" : best.sourceType,
    reason: best.reason ?? "No candles could be resolved.",
  };
  await persistSnapshot(finalUnavailable);
  return finalUnavailable;
}
