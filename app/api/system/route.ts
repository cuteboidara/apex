import { NextResponse } from "next/server";

import { buildRouteErrorResponse } from "@/lib/api/routeErrors";
import { getProviderSummaries } from "@/lib/marketData/providerStatus";
import { getQueueConfiguration, getSignalCycleQueue, QUEUE_UNAVAILABLE_REASON, queueAvailable } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { recordProviderHealth } from "@/lib/providerHealth";
import { classifyProviderStatus } from "@/lib/providerStatusClassifier";
import { buildLatestSetupBreakdown } from "@/lib/setupBreakdown";
import { getRuntimeCacheMode } from "@/lib/runtime/runtimeCache";
import { getRedisConfiguration, isRedisConfigured } from "@/lib/runtime/redis";

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
        openai: Boolean(process.env.OPENAI_API_KEY),
        gemini: Boolean(process.env.GEMINI_API_KEY),
        fred: Boolean(process.env.FRED_API_KEY),
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
            provider: { in: ["Redis", "Telegram", "Postgres", "Anthropic", "OpenAI", "Gemini", "RSS", "FRED"] },
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

      const providers: ProviderConfigRow[] = [
        { provider: "Anthropic", fallbackStatus: envFlags.anthropic ? "available" : "offline", detail: "Primary explanation model" },
        { provider: "OpenAI", fallbackStatus: envFlags.openai ? "available" : "offline", detail: "Secondary explanation fallback" },
        { provider: "Gemini", fallbackStatus: envFlags.gemini ? "available" : "offline", detail: "Final explanation fallback" },
        { provider: "RSS", fallbackStatus: "available", detail: "Free market news feeds" },
        { provider: "FRED", fallbackStatus: envFlags.fred ? "available" : "offline", detail: "Macro data" },
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
          const latest = latestSystemProvider.get(item.provider);
          const detail = latest?.detail
            ? `${latest.requestSymbol ? `${latest.requestSymbol} · ` : ""}${latest.detail}`
            : item.detail;
          const classified = deps.classifyProviderStatus(latest?.status?.toLowerCase() ?? item.fallbackStatus, detail, item.provider);
          return {
            provider: item.provider,
            assetClass: null,
            status: classified.displayStatus,
            detail,
            latencyMs: latest?.latencyMs ?? null,
            recordedAt: latest?.recordedAt?.toISOString?.() ?? null,
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
      const commentaryProvider =
        providerRows.find(row => row.assetClass == null && ["Anthropic", "OpenAI", "Gemini"].includes(row.provider) && row.availability === "available") ??
        providerRows.find(row => row.assetClass == null && ["Anthropic", "OpenAI", "Gemini"].includes(row.provider)) ??
        null;
      const blockedProviders = providerRows.filter(row => row.availability === "blocked");
      const queueStatus = queue.status === "online" ? "ONLINE" : "DEGRADED";
      const queueReason = queue.status === "online"
        ? null
        : !deps.queueAvailable
          ? deps.queueUnavailableReason
          : queue.failureReason ?? "Queue unavailable";
      const commentaryMode = commentaryProvider?.availability === "available" ? "llm" : "template";
      const commentaryDetail = commentaryProvider?.availability === "available"
        ? commentaryProvider?.detail ?? "LLM explanation provider available."
        : "LLM providers are unavailable. Deterministic templates remain available.";

      return NextResponse.json({
        ok: true,
        stats,
        status: queueStatus,
        reason: queueReason,
        runtime: {
          redisEnabled: envFlags.redis,
          redisSource: redisConfig.source,
          redisRestOnlyConfigured: redisConfig.restOnlyConfigured,
          queueAvailable: deps.queueAvailable,
          queueMode: queue.status === "online" ? "queue" : "direct",
          cacheMode,
        },
        queue,
        providers: providerRows,
        blockedProviders,
        commentary: {
          provider: commentaryProvider?.provider ?? "none",
          available: commentaryProvider?.availability === "available",
          mode: commentaryMode,
          status: commentaryProvider?.status ?? "offline",
          detail: commentaryDetail,
          blockedReason: commentaryProvider?.blockedReason ?? null,
          templateFallbackAvailable: true,
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
