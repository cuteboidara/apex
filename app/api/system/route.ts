import { NextResponse } from "next/server";

import { buildRouteErrorResponse } from "@/lib/api/routeErrors";
import { getProviderSummaries } from "@/lib/marketData/providerStatus";
import { getQueueConfiguration, getSignalCycleQueue, QUEUE_UNAVAILABLE_REASON, queueAvailable } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { recordProviderHealth } from "@/lib/providerHealth";
import { classifyProviderStatus } from "@/lib/providerStatusClassifier";
import { buildLatestSetupBreakdown } from "@/lib/setupBreakdown";
import { getCoreSignalRuntime } from "@/lib/runtime/featureFlags";
import { getRuntimeCacheMode } from "@/lib/runtime/runtimeCache";
import { getRedisConfiguration, isRedisConfigured } from "@/lib/runtime/redis";
import { getLlmRuntimePolicy } from "@/src/lib/apex-llm/runtimePolicy";

export const dynamic = "force-dynamic";

type ProviderHealthRecord = Awaited<ReturnType<typeof prisma.providerHealth.findMany>>[number];
type LatestTradePlanRecord = Awaited<ReturnType<typeof prisma.tradePlan.findMany>>[number];

type QueueStatus = {
  status: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  failureReason?: string;
  mode: "queue" | "direct";
  connectionSource: string | null;
};

type ProviderConfigRow = {
  provider: string;
  fallbackStatus: string;
  detail: string;
};

type ProviderResponseRow = {
  provider: string;
  assetClass: string | null;
  status: "available" | "degraded" | "offline";
  detail: string;
  latencyMs: number | null;
  recordedAt: string | null;
  score: number | null;
  healthState: string | null;
  circuitState: string | null;
  cooldownUntil: string | null;
  availability: string;
  blockedReason: string | null;
};

type ServiceHealthState = "available" | "degraded" | "offline";

type SystemRouteDependencies = {
  prisma: typeof prisma;
  getProviderSummaries: typeof getProviderSummaries;
  recordProviderHealth: typeof recordProviderHealth;
  classifyProviderStatus: typeof classifyProviderStatus;
  buildLatestSetupBreakdown: typeof buildLatestSetupBreakdown;
  getQueueConfiguration: typeof getQueueConfiguration;
  getSignalCycleQueue: typeof getSignalCycleQueue;
  queueAvailable: boolean;
  queueUnavailableReason: string | null;
  getRuntimeCacheMode: typeof getRuntimeCacheMode;
  getRedisConfiguration: typeof getRedisConfiguration;
  isRedisConfigured: typeof isRedisConfigured;
};

function round(value: number) {
  return Math.round(value * 10) / 10;
}

function summarizeStatus(states: ServiceHealthState[]) {
  if (states.includes("offline")) {
    return "offline" as const;
  }

  if (states.includes("degraded")) {
    return "degraded" as const;
  }

  return "available" as const;
}

function formatAssetClassLabel(assetClass: string) {
  if (assetClass === "COMMODITY") return "metals";
  return assetClass.toLowerCase();
}

function parseFeedFailures(detail: string | null | undefined) {
  const normalized = String(detail ?? "").trim();
  if (!normalized.toLowerCase().startsWith("feed_failures:")) {
    return [];
  }

  return normalized
    .slice("feed_failures:".length)
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function isRecentRssFailure(record: ProviderHealthRecord) {
  const status = String(record.status ?? "").toLowerCase();
  const detail = String(record.detail ?? "").toLowerCase();
  return ["error", "offline", "unavailable", "unhealthy"].includes(status) ||
    detail.includes("rss_unavailable") ||
    detail.includes("feed_failures:");
}

async function safeQuery<T>(query: () => Promise<T>, fallback: T): Promise<T> {
  try {
    const value = await query();
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

async function buildSystemStats(db: typeof prisma) {
  const winOutcomes = ["TP1", "TP2", "TP3", "STOP_AFTER_TP1", "STOP_AFTER_TP2"] as const;
  const lossOutcomes = ["STOP"] as const;

  const [signals, runs, tradePlans, alerts, wins, losses] = await Promise.all([
    safeQuery(() => db.signal.count(), 0),
    safeQuery(() => db.signalRun.count(), 0),
    safeQuery(() => db.tradePlan.count(), 0),
    safeQuery(() => db.alert.count(), 0),
    safeQuery(() => db.tradePlan.count({ where: { outcome: { in: [...winOutcomes] } } }), 0),
    safeQuery(() => db.tradePlan.count({ where: { outcome: { in: [...lossOutcomes] } } }), 0),
  ]);

  const resolved = wins + losses;

  return {
    signals,
    runs,
    tradePlans,
    alerts,
    resolvedTrades: resolved,
    winRate: resolved > 0 ? round((wins / resolved) * 100) : 0,
  };
}

async function buildQueueStatus(deps: SystemRouteDependencies): Promise<QueueStatus> {
  const queueConfig = deps.getQueueConfiguration();

  if (!deps.queueAvailable) {
    return {
      status: "offline",
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      failureReason: deps.queueUnavailableReason ?? "Queue unavailable",
      mode: "direct",
      connectionSource: queueConfig.source,
    };
  }

  try {
    const counts = await deps.getSignalCycleQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed");
    await deps.recordProviderHealth({
      provider: "Redis",
      status: "OK",
      errorRate: 0,
    }).catch(() => undefined);
    return {
      status: "online",
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      mode: "queue",
      connectionSource: queueConfig.source,
    };
  } catch (error) {
    await deps.recordProviderHealth({
      provider: "Redis",
      status: "ERROR",
      errorRate: 1,
    }).catch(() => undefined);
    return {
      status: "offline",
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      failureReason: String(error),
      mode: "direct",
      connectionSource: queueConfig.source,
    };
  }
}

export function createSystemRouteHandler(deps: SystemRouteDependencies) {
  return async function GET() {
    try {
      const envFlags = {
        anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
        twelveData: Boolean(process.env.TWELVE_DATA_API_KEY),
        database: Boolean(process.env.DATABASE_URL ?? process.env.DIRECT_DATABASE_URL),
        telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        redis: deps.isRedisConfigured(),
      };
      const redisConfig = deps.getRedisConfiguration();
      const cacheMode = deps.getRuntimeCacheMode();

      const [queue, providerSummaries, systemProviders, latestCompletedRun, stats] = await Promise.all([
        buildQueueStatus(deps),
        safeQuery(() => deps.getProviderSummaries(), []),
        safeQuery(() => deps.prisma.providerHealth.findMany({
          where: {
            provider: { in: ["Redis", "Telegram", "Postgres", "Anthropic", "RSS", "Twelve Data", "TwelveData"] },
            requestSymbol: null,
          },
          orderBy: { recordedAt: "desc" },
          take: 50,
        }), [] as ProviderHealthRecord[]),
        safeQuery(() => deps.prisma.signalRun.findFirst({
          where: { status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
          select: { id: true },
        }), null as { id: string } | null),
        buildSystemStats(deps.prisma),
      ]);

      const runtimeConfig = getCoreSignalRuntime();
      const llmPolicy = getLlmRuntimePolicy();
      const providers: ProviderConfigRow[] = [
        {
          provider: "Anthropic",
          fallbackStatus: llmPolicy.disabled ? "degraded" : envFlags.anthropic ? "available" : "offline",
          detail: llmPolicy.disabled ? "LLM calls disabled by APEX_DISABLE_LLM" : "Claude reasoning and market commentary for the focused runtime",
        },
        {
          provider: "RSS",
          fallbackStatus: runtimeConfig.newsDisabled ? "degraded" : "available",
          detail: runtimeConfig.newsDisabled ? "News enrichment disabled by APEX_DISABLE_NEWS" : "Free market news feeds",
        },
        { provider: "Twelve Data", fallbackStatus: envFlags.twelveData ? "available" : "offline", detail: "Live FX pricing" },
        { provider: "Telegram", fallbackStatus: envFlags.telegram ? "available" : "offline", detail: "Alert delivery" },
        { provider: "Redis", fallbackStatus: queue.status === "online" ? "available" : "offline", detail: "Signal cycle queue" },
        { provider: "Postgres", fallbackStatus: envFlags.database ? "available" : "offline", detail: "Primary persistence" },
      ];

      const latestSystemProvider = new Map<string, ProviderHealthRecord>();
      for (const row of systemProviders) {
        if (!latestSystemProvider.has(row.provider)) latestSystemProvider.set(row.provider, row);
      }

      const providerRows: ProviderResponseRow[] = [
        ...providers.map(item => {
          const llmDisabledProvider = llmPolicy.disabled && item.provider === "Anthropic";
          const newsDisabledProvider = runtimeConfig.newsDisabled && item.provider === "RSS";
          const optionalProviderDisabled = llmDisabledProvider || newsDisabledProvider;
          const latest = latestSystemProvider.get(item.provider);
          const detail = optionalProviderDisabled
            ? item.detail
            : latest?.detail
            ? `${latest.requestSymbol ? `${latest.requestSymbol} · ` : ""}${latest.detail}`
            : item.detail;
          const classified = deps.classifyProviderStatus(
            optionalProviderDisabled ? item.fallbackStatus : latest?.status?.toLowerCase() ?? item.fallbackStatus,
            detail,
            item.provider
          );
          return {
            provider: item.provider,
            assetClass: null,
            status: classified.displayStatus,
            detail,
            latencyMs: optionalProviderDisabled ? null : latest?.latencyMs ?? null,
            recordedAt: optionalProviderDisabled ? null : latest?.recordedAt?.toISOString?.() ?? null,
            score: null,
            healthState: null,
            circuitState: null,
            cooldownUntil: null,
            availability: classified.availability,
            blockedReason: classified.blockedReason,
          };
        }),
        ...providerSummaries.map(summary => {
          const detail = summary.detail;
          const classified = deps.classifyProviderStatus(summary.status, detail, summary.provider);
          return {
            provider: summary.provider,
            assetClass: summary.assetClass,
            status: classified.displayStatus,
            detail,
            latencyMs: summary.latencyMs,
            recordedAt: summary.recordedAt,
            score: summary.score,
            healthState: summary.healthState,
            circuitState: summary.circuitState,
            cooldownUntil: summary.cooldownUntil,
            availability: classified.availability,
            blockedReason: classified.blockedReason,
          };
        }),
      ];

      const latestPlans = latestCompletedRun
        ? await safeQuery(() => deps.prisma.tradePlan.findMany({
            where: { runId: latestCompletedRun.id },
            orderBy: { createdAt: "desc" },
          }), [] as LatestTradePlanRecord[])
        : [];

      const setupBreakdown = deps.buildLatestSetupBreakdown(latestPlans);
      const llmProviders = providerRows.filter(row => row.assetClass == null && row.provider === "Anthropic");
      const activeCommentaryProvider = llmProviders.find(row => row.availability === "available") ?? null;
      const commentaryFailure = llmProviders.find(row => row.availability !== "available") ?? null;
      const rssProvider = providerRows.find(row => row.assetClass == null && row.provider === "RSS") ?? null;
      const marketProviders = providerRows.filter(row => row.assetClass != null);
      const rssHistory = systemProviders.filter(row => row.provider === "RSS");
      const recentRssHistory = rssHistory.slice(0, 3);
      const rssConsistentlyUnavailable =
        recentRssHistory.length >= 3 &&
        recentRssHistory.every(isRecentRssFailure) &&
        recentRssHistory.every(row => String(row.detail ?? "").toLowerCase().includes("rss_unavailable"));
      const failedFeeds = parseFeedFailures(rssProvider?.detail);
      const loadedFeeds = rssProvider?.detail?.toLowerCase().includes("rss_unavailable")
        ? 0
        : Math.max(0, 3 - failedFeeds.length);
      const marketAssetClasses = ["FOREX", "COMMODITY", "CRYPTO"];
      const offlineMarketClasses = marketAssetClasses.filter(assetClass => {
        const rows = marketProviders.filter(row => row.assetClass === assetClass);
        return rows.length === 0 || rows.every(row => row.availability === "offline");
      });
      const degradedMarketClasses = marketAssetClasses.filter(assetClass => {
        const rows = marketProviders.filter(row => row.assetClass === assetClass);
        return rows.length > 0 && rows.some(row => row.availability === "degraded" || row.availability === "blocked");
      });
      const marketDataStatus: ServiceHealthState = offlineMarketClasses.length > 0
        ? "offline"
        : degradedMarketClasses.length > 0
          ? "degraded"
          : "available";
      const marketDataDetail = marketDataStatus === "available"
        ? "Yahoo Finance and Binance are returning usable market data."
        : marketDataStatus === "offline"
          ? `${offlineMarketClasses.map(formatAssetClassLabel).join(", ")} market data is unavailable.`
          : `${degradedMarketClasses.map(formatAssetClassLabel).join(", ")} market data is degraded or stale.`;
      const queueServiceStatus: ServiceHealthState = queue.status === "online" ? "available" : "degraded";
      const databaseStatus: ServiceHealthState = envFlags.database ? "available" : "offline";
      const coreStatus = summarizeStatus([databaseStatus, queueServiceStatus, marketDataStatus]);
      const coreDetail = [
        databaseStatus === "available" ? "Postgres persistence available." : "Database connection is not configured.",
        queueServiceStatus === "available"
          ? "Redis-backed queue available."
          : queue.failureReason
            ? `Queue fallback active: ${queue.failureReason}`
            : "Queue fallback active: inline execution remains available.",
        marketDataDetail,
      ].join(" ");
      const commentaryStatus: ServiceHealthState = llmPolicy.disabled
        ? "degraded"
        : activeCommentaryProvider
          ? "available"
          : llmPolicy.optional
            ? "degraded"
            : "offline";
      const commentaryMode = llmPolicy.disabled
        ? "disabled"
        : activeCommentaryProvider
          ? "llm"
          : "template";
      const commentaryDetail = llmPolicy.disabled
        ? "LLM calls are disabled. Deterministic templates remain available."
        : activeCommentaryProvider
          ? activeCommentaryProvider.detail ?? "LLM explanation provider available."
          : commentaryFailure
            ? `LLM providers are unavailable. Deterministic templates remain available. Latest issue: ${commentaryFailure.provider}: ${commentaryFailure.detail}`
            : "No LLM providers are configured. Deterministic templates remain available.";
      const newsStatus: ServiceHealthState = runtimeConfig.newsDisabled
        ? "degraded"
        : rssProvider == null
        ? "available"
        : rssProvider.availability === "available"
          ? "available"
          : rssConsistentlyUnavailable
            ? "offline"
            : "degraded";
      const newsDetail = runtimeConfig.newsDisabled
        ? "News enrichment is disabled. Signal generation continues without RSS context."
        : rssProvider == null
        ? "RSS feeds will be checked on demand. Empty news does not block signals."
        : newsStatus === "available"
          ? "RSS feeds are responding normally."
          : newsStatus === "offline"
            ? "All RSS feeds are currently unavailable. Signal generation continues without fresh news."
            : failedFeeds.length > 0
              ? `RSS is partially degraded. Failed feeds: ${failedFeeds.join(", ")}.`
              : "RSS feeds are temporarily unavailable. Signal generation continues without fresh news.";
      const blockedProviders = providerRows.filter(row =>
        row.availability === "blocked" &&
        !["Anthropic", "RSS"].includes(row.provider)
      );
      const topLevelStatus = coreStatus === "available"
        ? "ONLINE"
        : coreStatus === "degraded"
          ? "DEGRADED"
          : "OFFLINE";
      const topLevelReason = coreStatus === "available" ? null : coreDetail;

      return NextResponse.json({
        ok: true,
        stats,
        status: topLevelStatus,
        reason: topLevelReason,
        runtime: {
          coreSignalMode: runtimeConfig.coreSignalMode,
          redisEnabled: envFlags.redis,
          redisSource: redisConfig.source,
          redisRestOnlyConfigured: redisConfig.restOnlyConfigured,
          queueAvailable: deps.queueAvailable,
          queueMode: queue.status === "online" ? "queue" : "direct",
          llmDisabled: runtimeConfig.llmDisabled,
          newsDisabled: runtimeConfig.newsDisabled,
          cacheMode,
        },
        queue,
        providers: providerRows,
        blockedProviders,
        core: {
          available: coreStatus !== "offline",
          status: coreStatus,
          detail: coreDetail,
          databaseStatus,
          queueStatus: queueServiceStatus,
          marketDataStatus,
          engineStatus: "available",
        },
        commentary: {
          provider: llmPolicy.disabled ? "LLM disabled" : activeCommentaryProvider?.provider ?? "Template fallback",
          available: commentaryStatus !== "offline",
          mode: commentaryMode,
          status: commentaryStatus,
          detail: commentaryDetail,
          blockedReason: commentaryFailure?.blockedReason ?? null,
          templateFallbackAvailable: true,
          optional: llmPolicy.optional,
          llmDisabled: llmPolicy.disabled,
        },
        news: {
          provider: "RSS",
          available: newsStatus !== "offline",
          status: newsStatus,
          detail: newsDetail,
          loadedFeeds: rssProvider == null ? 0 : loadedFeeds,
          failedFeeds,
        },
        latestSetupBreakdown: setupBreakdown,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return buildRouteErrorResponse(error, {
        publicMessage: "Unable to load system stats.",
      });
    }
  };
}

export const GET = createSystemRouteHandler({
  prisma,
  getProviderSummaries,
  recordProviderHealth,
  classifyProviderStatus,
  buildLatestSetupBreakdown,
  getQueueConfiguration,
  getSignalCycleQueue,
  queueAvailable,
  queueUnavailableReason: QUEUE_UNAVAILABLE_REASON,
  getRuntimeCacheMode,
  getRedisConfiguration,
  isRedisConfigured,
});
