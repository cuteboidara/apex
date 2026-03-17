import { NextResponse } from "next/server";
import { getProviderSummaries } from "@/lib/marketData/providerStatus";
import { signalCycleQueue } from "@/lib/queue";
import { prisma } from "@/lib/prisma";
import { recordProviderHealth } from "@/lib/providerHealth";

export async function GET() {
  const envFlags = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY && process.env.ALPHA_VANTAGE_API_KEY !== "PASTE_YOUR_KEY_HERE"),
    newsApi: Boolean(process.env.NEWS_API_KEY),
    fred: Boolean(process.env.FRED_API_KEY),
    finnhub: Boolean(process.env.FINNHUB_API_KEY),
    database: Boolean(process.env.DIRECT_DATABASE_URL),
    telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    redis: Boolean(process.env.REDIS_URL),
  };

  let queue;
  try {
    const counts = await signalCycleQueue.getJobCounts("waiting", "active", "completed", "failed", "delayed");
    await recordProviderHealth({
      provider: "Redis",
      status: "OK",
      errorRate: 0,
    });
    queue = {
      status: "online",
      ...counts,
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
    };
  }

  const providers = [
    { provider: "Anthropic", fallbackStatus: envFlags.anthropic ? "configured" : "missing", detail: "Explanation model" },
    { provider: "Alpha Vantage", fallbackStatus: envFlags.alphaVantage ? "configured" : "missing", detail: "FX and metals market data" },
    { provider: "Twelve Data", fallbackStatus: Boolean(process.env.TWELVE_DATA_API_KEY) ? "configured" : "missing", detail: "Fallback FX, metals, and crypto market data" },
    { provider: "NewsAPI", fallbackStatus: envFlags.newsApi ? "configured" : "missing", detail: "Headline enrichment" },
    { provider: "FRED", fallbackStatus: envFlags.fred ? "configured" : "missing", detail: "Macro data" },
    { provider: "Finnhub", fallbackStatus: envFlags.finnhub ? "configured" : "missing", detail: "Market news and calendar" },
    { provider: "Telegram", fallbackStatus: envFlags.telegram ? "configured" : "missing", detail: "Alert delivery" },
    { provider: "Redis", fallbackStatus: queue.status === "online" ? "online" : "offline", detail: "Signal cycle queue" },
    { provider: "Postgres", fallbackStatus: envFlags.database ? "configured" : "missing", detail: "Primary persistence" },
  ];

  const providerSummaries = await getProviderSummaries();

  const systemProviders = await prisma.providerHealth.findMany({
    where: { provider: { in: ["Redis", "Telegram", "Postgres", "Anthropic", "NewsAPI", "FRED", "Finnhub"] } },
    orderBy: { recordedAt: "desc" },
    take: 50,
  }).catch(() => []);

  const latestSystemProvider = new Map<string, (typeof systemProviders)[number]>();
  for (const row of systemProviders) {
    if (!latestSystemProvider.has(row.provider)) latestSystemProvider.set(row.provider, row);
  }

  const providerRows = [
    ...providers
      .filter(item => !["Alpha Vantage", "Twelve Data"].includes(item.provider))
      .map(item => {
        const latest = latestSystemProvider.get(item.provider);
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
        };
      }),
    ...providerSummaries.map(summary => ({
      provider: summary.provider,
      assetClass: summary.assetClass,
      status: summary.status,
      detail: summary.detail,
      latencyMs: summary.latencyMs,
      recordedAt: summary.recordedAt,
      score: summary.score,
      healthState: summary.healthState,
      circuitState: summary.circuitState,
    })),
  ];

  return NextResponse.json({
    queue,
    providers: providerRows,
    timestamp: new Date().toISOString(),
  });
}
