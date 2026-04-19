import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { ADMIN_EMAIL } from "@/lib/admin/auth";
import { auditLog } from "@/lib/admin/auditLog";
import { buildRouteErrorResponse } from "@/lib/api/routeErrors";
import { validateRuntimeEnv } from "@/scripts/validate-env.mjs";
import { getLatestAlphaAnalyticsReport, runAlphaAnalyticsRefresh } from "@/src/application/analytics/alphaReport";
import { generateDailyAlphaReport } from "@/src/application/analytics/dailyAlphaReport";
import { getProviderReliabilitySummaries } from "@/src/application/analytics/providerDiagnostics";
import { getLatestLiveRuntimeSmokeReport, getLiveRuntimeSmokeDashboard, runLiveRuntimeSmokeVerification } from "@/src/application/analytics/liveRuntimeVerification";

export const dynamic = "force-dynamic";

const ENV_KEYS = [
  "DATABASE_URL",
  "NEXTAUTH_SECRET",
  "NEXTAUTH_URL",
  "APEX_SECRET",
  "TWELVE_DATA_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "ANTHROPIC_API_KEY",
  "APEX_DISABLE_LLM",
  "APEX_DAILY_SIGNALS_SECRET",
  "REDIS_URL",
] as const;

export async function GET() {
  let dbStatus = "OK";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "ERROR";
  }

  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const [latestRun, pendingAlerts, failedAlerts, recentProviderHealth, liveSmokeReport, alphaAnalytics, providerReliability, latestDailyAlphaReport] = await Promise.all([
      prisma.signalRun.findFirst({ orderBy: { queuedAt: "desc" } }),
      prisma.alert.count({ where: { status: "PENDING" } }),
      prisma.alert.count({ where: { status: "FAILED" } }),
      prisma.providerHealth.findMany({
        orderBy: { recordedAt: "desc" },
        take: 10,
        select: { provider: true, status: true, latencyMs: true, errorRate: true, recordedAt: true },
      }),
      getLatestLiveRuntimeSmokeReport(),
      getLatestAlphaAnalyticsReport(),
      getProviderReliabilitySummaries({ lookbackHours: 72 }),
      prisma.systemEvent.findFirst({
        where: {
          type: "daily_alpha_report_generated",
        },
        orderBy: {
          ts: "desc",
        },
        select: {
          payload: true,
        },
      }),
    ]);
    const liveSmokeDashboard = await getLiveRuntimeSmokeDashboard(liveSmokeReport);

    const envStatus = Object.fromEntries(
      ENV_KEYS.map(key => [key, !!process.env[key]]),
    );

    const envChecks = {
      web: validateRuntimeEnv({ service: "web", strict: process.env.NODE_ENV === "production" }),
      worker: validateRuntimeEnv({ service: "worker", strict: process.env.NODE_ENV === "production" }),
      backfill: validateRuntimeEnv({ service: "backfill", strict: process.env.NODE_ENV === "production" }),
    };

    const OPTIONAL_PROVIDERS = new Set(["Anthropic", "RSS"]);
    const coreProviderHealth = recentProviderHealth.filter(row => !OPTIONAL_PROVIDERS.has(row.provider));
    const optionalProviderHealth = recentProviderHealth.filter(row => OPTIONAL_PROVIDERS.has(row.provider));

    return NextResponse.json({
      ok: true,
      latestRun,
      queue: { pending: pendingAlerts, failed: failedAlerts },
      envStatus,
      envChecks,
      dbStatus,
      providerHealth: coreProviderHealth,
      optionalProviderHealth,
      liveSmokeReport,
      liveSmokeDashboard,
      alphaAnalytics,
      providerReliability,
      latestDailyAlphaReport: latestDailyAlphaReport?.payload ?? null,
    });
  } catch (error) {
    return buildRouteErrorResponse(error, {
      publicMessage: "System control data",
    });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null) as { action?: string; includeSmoke?: boolean } | null;
    const action = body?.action ?? "";

    if (action === "run_live_smoke") {
      const liveSmokeReport = await runLiveRuntimeSmokeVerification();
      await auditLog("run_live_smoke", ADMIN_EMAIL);
      return NextResponse.json({
        ok: true,
        action,
        liveSmokeReport,
      });
    }

    if (action === "refresh_alpha_analytics") {
      const alphaAnalytics = await runAlphaAnalyticsRefresh({
        includeSmoke: body?.includeSmoke !== false,
      });
      await auditLog("refresh_alpha_analytics", ADMIN_EMAIL, {
        includeSmoke: body?.includeSmoke !== false,
      });
      return NextResponse.json({
        ok: true,
        action,
        alphaAnalytics,
      });
    }

    if (action === "run_daily_alpha_report") {
      const dailyAlphaReport = await generateDailyAlphaReport({
        includeSmoke: body?.includeSmoke !== false,
      });
      await auditLog("run_daily_alpha_report", ADMIN_EMAIL, {
        includeSmoke: body?.includeSmoke !== false,
      });
      return NextResponse.json({
        ok: true,
        action,
        dailyAlphaReport,
      });
    }

    return NextResponse.json({
      ok: false,
      error: "unsupported_action",
    }, { status: 400 });
  } catch (error) {
    return buildRouteErrorResponse(error, {
      publicMessage: "System control action",
    });
  }
}
