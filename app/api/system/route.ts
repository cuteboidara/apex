import { NextResponse } from "next/server";
import { getProviderSummaries } from "@/lib/marketData/providerStatus";
import { getQueueConfiguration, getSignalCycleQueue, QUEUE_UNAVAILABLE_REASON, queueAvailable } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { recordProviderHealth } from "@/lib/providerHealth";
import { classifyProviderStatus } from "@/lib/providerStatusClassifier";
import { buildLatestSetupBreakdown } from "@/lib/setupBreakdown";
import { getRuntimeCacheMode } from "@/lib/runtime/runtimeCache";
import { getRedisConfiguration, isRedisConfigured } from "@/lib/runtime/redis";

export async function GET() {
  type ProviderHealthRecord = Awaited<ReturnType<typeof prisma.providerHealth.findMany>>[number];
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
  type ProviderConfigRow = { provider: string; fallbackStatus: string; detail: string };
  type ProviderResponseRow = {
    provider: string;
    assetClass: string | null;
    status: string;
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
  type LatestTradePlanRecord = Awaited<ReturnType<typeof prisma.tradePlan.findMany>>[number];

  const envFlags = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
    fcs: Boolean(process.env.FCS_API_KEY && process.env.FCS_API_KEY !== "PASTE_YOUR_KEY_HERE"),
    alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY && process.env.ALPHA_VANTAGE_API_KEY !== "PASTE_YOUR_KEY_HERE"),
    newsApi: Boolean(process.env.NEWS_API_KEY),
    fred: Boolean(process.env.FRED_API_KEY),
    finnhub: Boolean(process.env.FINNHUB_API_KEY),
    database: Boolean(process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    redis: isRedisConfigured(),
  };
  const queueConfig = getQueueConfiguration();
  const redisConfig = getRedisConfiguration();
  const cacheMode = getRuntimeCacheMode();

  let queue: QueueStatus;
  if (!queueAvailable) {
    queue = {
      status: "offline",
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      failureReason: QUEUE_UNAVAILABLE_REASON,
      mode: "direct",
      connectionSource: queueConfig.source,
    };
  } else {
    try {
      const counts = await getSignalCycleQueue().getJobCounts("waiting", "active", "completed", "failed", "delayed");
      await recordProviderHealth({
        provider: "Redis",
        status: "OK",
        errorRate: 0,
      });
      queue = {
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
      await recordProviderHealth({
        provider: "Redis",
        status: "ERROR",
        errorRate: 1,
      });
      queue = {
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

  const providers: ProviderConfigRow[] = [
    { provider: "Anthropic", fallbackStatus: envFlags.anthropic ? "configured" : "missing", detail: "Primary explanation model" },
    { provider: "OpenAI", fallbackStatus: envFlags.openai ? "configured" : "missing", detail: "Secondary explanation fallback" },
    { provider: "Gemini", fallbackStatus: envFlags.gemini ? "configured" : "missing", detail: "Final explanation fallback" },
    { provider: "NewsAPI", fallbackStatus: envFlags.newsApi ? "configured" : "missing", detail: "Headline enrichment" },
    { provider: "FRED", fallbackStatus: envFlags.fred ? "configured" : "missing", detail: "Macro data" },
    { provider: "Finnhub", fallbackStatus: envFlags.finnhub ? "configured" : "missing", detail: "Market news, calendar, and institutional context" },
    { provider: "Telegram", fallbackStatus: envFlags.telegram ? "configured" : "missing", detail: "Alert delivery" },
    { provider: "Redis", fallbackStatus: queue.status === "online" ? "online" : queue.status, detail: "Signal cycle queue" },
    { provider: "Postgres", fallbackStatus: envFlags.database ? "configured" : "missing", detail: "Primary persistence" },
  ];
  const marketProviderConfig: Record<string, { enabled: boolean; detail: string }> = {
    "Binance": { enabled: true, detail: "Primary crypto quotes and candles" },
    "FCS API": { enabled: envFlags.fcs, detail: "Primary FX and metals quotes/candles, optional crypto fallback" },
    "Alpha Vantage": { enabled: envFlags.alphaVantage, detail: "Fallback FX and metals quotes plus indicator enrichment" },
  };

  const providerSummaries = await getProviderSummaries();

  const systemProviders: ProviderHealthRecord[] = await prisma.providerHealth.findMany({
    where: {
      provider: { in: ["Redis", "Telegram", "Postgres", "Anthropic", "OpenAI", "Gemini", "NewsAPI", "FRED", "Finnhub"] },
      requestSymbol: null,
    },
    orderBy: { recordedAt: "desc" },
    take: 50,
  }).catch(() => [] as ProviderHealthRecord[]);

  const latestSystemProvider = new Map<string, ProviderHealthRecord>();
  for (const row of systemProviders as ProviderHealthRecord[]) {
    if (!latestSystemProvider.has(row.provider)) latestSystemProvider.set(row.provider, row);
  }

  const providerRows: ProviderResponseRow[] = [
    ...providers.map((item: ProviderConfigRow): ProviderResponseRow => {
        const latest = latestSystemProvider.get(item.provider);
        const classified = classifyProviderStatus(latest?.status?.toLowerCase() ?? item.fallbackStatus, latest?.detail ?? item.detail);
        return {
          provider: item.provider,
          assetClass: null,
          status: latest?.status?.toLowerCase() ?? item.fallbackStatus,
          detail: latest?.detail
            ? `${latest.requestSymbol ? `${latest.requestSymbol} · ` : ""}${latest.detail}`
            : item.detail,
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
    ...providerSummaries.map((summary: (typeof providerSummaries)[number]) => {
      const marketConfig = marketProviderConfig[summary.provider];
      const status = marketConfig && !marketConfig.enabled ? "missing" : summary.status;
      const detail = marketConfig && !marketConfig.enabled
        ? `missing_api_key · ${marketConfig.detail}`
        : summary.detail;
      const classified = classifyProviderStatus(status, detail);
      return {
        provider: summary.provider,
        assetClass: summary.assetClass,
        status,
        detail,
        latencyMs: summary.latencyMs,
        recordedAt: summary.recordedAt,
        score: marketConfig && !marketConfig.enabled ? null : summary.score,
        healthState: marketConfig && !marketConfig.enabled ? null : summary.healthState,
        circuitState: marketConfig && !marketConfig.enabled ? null : summary.circuitState,
        cooldownUntil: marketConfig && !marketConfig.enabled ? null : summary.cooldownUntil,
        availability: classified.availability,
        blockedReason: classified.blockedReason,
      };
    }),
  ];

  const latestCompletedRun = await prisma.signalRun.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    select: { id: true },
  }).catch(() => null);
  const latestPlans = latestCompletedRun
    ? await prisma.tradePlan.findMany({
        where: { runId: latestCompletedRun.id },
        orderBy: { createdAt: "desc" },
      }).catch(() => [] as LatestTradePlanRecord[])
    : [];
  const setupBreakdown = buildLatestSetupBreakdown(latestPlans);
  const commentaryProvider =
    providerRows.find(row => row.assetClass == null && ["Anthropic", "OpenAI", "Gemini"].includes(row.provider) && row.availability === "available") ??
    providerRows.find(row => row.assetClass == null && ["Anthropic", "OpenAI", "Gemini"].includes(row.provider)) ??
    null;
  const blockedProviders = providerRows.filter(row => row.availability === "blocked");
  const queueStatus = queue.status === "online" ? "ONLINE" : "DEGRADED";
  const queueReason = queue.status === "online"
    ? null
    : !queueAvailable
      ? QUEUE_UNAVAILABLE_REASON
      : queue.failureReason ?? "Queue unavailable";
  const commentaryMode = commentaryProvider?.availability === "available" ? "llm" : "template";
  const commentaryDetail = commentaryProvider?.availability === "available"
    ? commentaryProvider?.detail ?? "LLM explanation provider available."
    : "LLM providers are blocked or missing. Deterministic templates remain available.";

  return NextResponse.json({
    status: queueStatus,
    reason: queueReason,
    runtime: {
      redisEnabled: envFlags.redis,
      redisSource: redisConfig.source,
      redisRestOnlyConfigured: redisConfig.restOnlyConfigured,
      queueAvailable,
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
      status: commentaryProvider?.status ?? "missing",
      detail: commentaryDetail,
      blockedReason: commentaryProvider?.blockedReason ?? null,
      templateFallbackAvailable: true,
    },
    latestSetupBreakdown: setupBreakdown,
    timestamp: new Date().toISOString(),
  });
}
