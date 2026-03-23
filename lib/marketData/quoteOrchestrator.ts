import { prisma } from "@/lib/prisma";
import {
  buildQuoteCacheKey,
  getCachedMarketValue,
  peekInflight,
  setCachedMarketValue,
  withInflightDedup,
} from "@/lib/marketData/cache/marketCache";
import { getProviderHealthScore, updateCircuitState } from "@/lib/marketData/providerHealthEngine";
import { selectProviders } from "@/lib/marketData/providerSelector";
import { shouldUseFallback } from "@/lib/marketData/policies/fallbackPolicy";
import { isQuoteFresh } from "@/lib/marketData/policies/freshnessPolicy";
import { resolveQuoteRequestPolicy, type MarketRequestContext } from "@/lib/marketData/policies/requestPolicy";
import { chooseBetter } from "@/lib/marketData/policies/quorumPolicy";
import type {
  AssetClass,
  CacheSourceType,
  FreshnessClass,
  MarketRequestPriority,
  MarketStatus,
  OrchestratedQuote,
  ProviderName,
  QuoteResult,
} from "@/lib/marketData/types";

type PersistedSignalRawData = {
  price?: {
    current?: number | null;
    change24h?: number | null;
    volume?: number | null;
    high14d?: number | null;
    low14d?: number | null;
  };
};

const KNOWN_PROVIDERS = new Set<ProviderName>(["Binance", "FCS API", "Alpha Vantage", "Twelve Data", "Finnhub"]);

function toPositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toProviderName(value: string | null | undefined): ProviderName | null {
  return value && KNOWN_PROVIDERS.has(value as ProviderName) ? (value as ProviderName) : null;
}

function deriveFreshnessMs(result: Pick<QuoteResult, "timestamp">, fallbackTimestamp: number | null) {
  const reference = result.timestamp ?? fallbackTimestamp;
  return reference != null ? Math.max(0, Date.now() - reference) : null;
}

function finalizeQuote(
  result: QuoteResult,
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
): OrchestratedQuote {
  const freshnessMs = deriveFreshnessMs(result, input.fetchedAt);
  const marketStatus = input.marketStatus ?? (
    input.freshnessClass === "fresh"
      ? result.marketStatus
      : result.marketStatus === "UNAVAILABLE"
        ? "UNAVAILABLE"
        : "DEGRADED"
  );
  const stale = result.stale || input.freshnessClass !== "fresh" || result.price == null || result.price <= 0 || marketStatus !== "LIVE";

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

async function getPersistedQuoteFallback(
  symbol: string,
  assetClass: AssetClass,
  defaultProvider: ProviderName,
  circuitState: string | null,
  priority: MarketRequestPriority
): Promise<OrchestratedQuote | null> {
  type SnapshotRecord = Awaited<ReturnType<typeof prisma.marketDataSnapshot.findMany>>[number];
  type SignalRecord = {
    createdAt: Date;
    rawData: unknown;
  };

  const [snapshots, signals] = await Promise.all([
    prisma.marketDataSnapshot.findMany({
      where: {
        symbol,
        assetClass,
        timeframe: "quote",
      },
      orderBy: { capturedAt: "desc" },
      take: 20,
    }).catch(() => [] as SnapshotRecord[]),
    prisma.signal.findMany({
      where: {
        asset: symbol,
        assetClass,
        run: { status: "COMPLETED" },
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        rawData: true,
      },
      take: 20,
    }).catch(() => [] as SignalRecord[]),
  ]);

  const snapshot = snapshots.find(row => toPositiveNumber(row.price) != null) ?? null;
  const signal = signals.find(row => {
    const raw = (row.rawData ?? {}) as PersistedSignalRawData;
    return toPositiveNumber(raw.price?.current) != null;
  }) ?? null;
  const signalRaw = (signal?.rawData ?? {}) as PersistedSignalRawData;
  const signalPrice = toPositiveNumber(signalRaw.price?.current);
  const snapshotPrice = toPositiveNumber(snapshot?.price);

  const snapshotTimestamp = snapshot?.capturedAt?.getTime?.() ?? null;
  const signalTimestamp = signal?.createdAt?.getTime?.() ?? null;
  const useSnapshot = snapshotPrice != null && (snapshotTimestamp ?? 0) >= (signalTimestamp ?? 0);
  const useSignal = signalPrice != null && !useSnapshot;

  if (!useSnapshot && !useSignal) {
    return null;
  }

  if (useSnapshot) {
    return finalizeQuote({
      symbol,
      assetClass,
      provider: defaultProvider,
      price: snapshotPrice,
      change24h: null,
      high14d: toNullableNumber(snapshot?.high),
      low14d: toNullableNumber(snapshot?.low),
      volume: toNullableNumber(snapshot?.volume),
      timestamp: snapshotTimestamp,
      stale: true,
      marketStatus: "DEGRADED",
      reason: "Using persisted quote snapshot because live providers are unavailable.",
      closes: [],
    }, {
      selectedProvider: toProviderName(snapshot?.provider),
      fallbackUsed: true,
      fromCache: true,
      circuitState,
      providerHealthScore: null,
      sourceType: "fallback",
      freshnessClass: "stale",
      fetchedAt: snapshotTimestamp,
      cacheKey: null,
      priority,
    });
  }

  return finalizeQuote({
    symbol,
    assetClass,
    provider: defaultProvider,
    price: signalPrice,
    change24h: toNullableNumber(signalRaw.price?.change24h),
    high14d: toNullableNumber(signalRaw.price?.high14d),
    low14d: toNullableNumber(signalRaw.price?.low14d),
    volume: toNullableNumber(signalRaw.price?.volume),
    timestamp: signalTimestamp,
    stale: true,
    marketStatus: "DEGRADED",
    reason: "Using the last persisted signal snapshot because live providers are unavailable.",
    closes: [],
  }, {
    selectedProvider: null,
    fallbackUsed: true,
    fromCache: true,
    circuitState,
    providerHealthScore: null,
    sourceType: "fallback",
    freshnessClass: "stale",
    fetchedAt: signalTimestamp,
    cacheKey: null,
    priority,
  });
}

function allowFallbackProvider(provider: ProviderName, input: { allowRareFallback: boolean }) {
  if (provider !== "Alpha Vantage") return true;
  return input.allowRareFallback;
}

async function fetchProviderQuoteWithPolicy(input: {
  symbol: string;
  assetClass: AssetClass;
  provider: { provider: ProviderName; fetchQuote: (symbol: string) => Promise<QuoteResult> };
  priority: MarketRequestPriority;
  policy: ReturnType<typeof resolveQuoteRequestPolicy>;
  health: Awaited<ReturnType<typeof getProviderHealthScore>>;
}) {
  const cacheKey = buildQuoteCacheKey({
    provider: input.provider.provider,
    assetClass: input.assetClass,
    symbol: input.symbol,
    bucketMs: input.policy.bucketMs,
  });

  const cached = await getCachedMarketValue<QuoteResult>(cacheKey);
  if (cached) {
    const cachedResult = finalizeQuote(cached.envelope.value, {
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
        : cached.envelope.value.reason ?? `Serving stale cached ${input.provider.provider} quote while refresh is pending.`,
    });

    if (cached.freshnessClass === "fresh" || !input.policy.allowStaleWhileRevalidate) {
      return cachedResult;
    }

    if (input.policy.allowBackgroundRefresh && !peekInflight(cacheKey)) {
      void withInflightDedup(cacheKey, async () => {
        await fetchProviderQuoteWithPolicy({
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
    const rawResult = await input.provider.fetchQuote(input.symbol);
    const freshness = isQuoteFresh(rawResult);
    await updateCircuitState({
      provider: input.provider.provider,
      assetClass: input.assetClass,
      success: rawResult.marketStatus === "LIVE" && freshness.fresh,
      detail: rawResult.reason,
    });

    if (rawResult.price != null && rawResult.price > 0) {
      await setCachedMarketValue(cacheKey, rawResult, {
        freshTtlMs: input.policy.freshTtlMs,
        staleTtlMs: input.policy.staleTtlMs,
        provider: input.provider.provider,
        degraded: rawResult.marketStatus !== "LIVE" || !freshness.fresh,
        priority: input.priority,
      });
    }

    return finalizeQuote(rawResult, {
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

export async function orchestrateQuote(
  symbol: string,
  assetClass: AssetClass,
  context?: MarketRequestContext
): Promise<OrchestratedQuote> {
  // FOREX and COMMODITY are served exclusively by Yahoo Finance via fetchMultiProviderAsset
  // and getAssetPrice — they must never reach the orchestrator (which would try FCS/AlphaVantage).
  if (assetClass === "FOREX" || assetClass === "COMMODITY") {
    console.warn(`[APEX:orchestrator] orchestrateQuote called for ${assetClass} ${symbol} — short-circuiting, Yahoo Finance handles these`);
    const policy = resolveQuoteRequestPolicy(assetClass, context);
    return finalizeQuote({
      symbol,
      assetClass,
      provider: "Yahoo Finance" as ProviderName,
      price: null,
      change24h: null,
      high14d: null,
      low14d: null,
      volume: null,
      timestamp: null,
      stale: true,
      marketStatus: "UNAVAILABLE",
      reason: "FOREX/COMMODITY routed to Yahoo Finance — orchestrator bypassed.",
      closes: [],
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

  const policy = resolveQuoteRequestPolicy(assetClass, context);
  const { primary, fallbacks } = await selectProviders(assetClass);

  if (!primary) {
    return finalizeQuote({
      symbol,
      assetClass,
      provider: "Alpha Vantage",
      price: null,
      change24h: null,
      high14d: null,
      low14d: null,
      volume: null,
      timestamp: null,
      stale: true,
      marketStatus: "UNAVAILABLE",
      reason: "No provider registered.",
      closes: [],
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
  const primaryResult = await fetchProviderQuoteWithPolicy({
    symbol,
    assetClass,
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
      const fallbackResult = await fetchProviderQuoteWithPolicy({
        symbol,
        assetClass,
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

      if (best.marketStatus === "LIVE" && best.price != null && best.price > 0) {
        break;
      }
    }
  }

  if (best.marketStatus === "LIVE" && best.price != null && best.price > 0) {
    await persistSnapshot(best);
    return best;
  }

  if (best.fromCache && best.price != null && best.price > 0) {
    const degraded = {
      ...best,
      marketStatus: "DEGRADED" as const,
      degraded: true,
      sourceType: best.sourceType === "cache" ? "stale-cache" : best.sourceType,
      freshnessClass: best.freshnessClass === "fresh" ? "stale" : best.freshnessClass,
      reason: best.reason ?? "Using last-known-good cache.",
    };
    await persistSnapshot(degraded);
    return degraded;
  }

  const persistedFallback = await getPersistedQuoteFallback(
    symbol,
    assetClass,
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
    reason: best.reason ?? "No quote could be resolved.",
  };
  await persistSnapshot(finalUnavailable);
  return finalUnavailable;
}
