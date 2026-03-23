import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { validateRuntimeEnv } from "@/scripts/validate-env.mjs";

export const dynamic = "force-dynamic";

const ENV_KEYS = [
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "REDIS_URL",
  "UPSTASH_REDIS_REST_URL",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "FRED_API_KEY",
  "RESEND_API_KEY",
  "NEXTAUTH_SECRET",
  "APEX_EVIDENCE_GATE_MIN_SAMPLE_SIZE",
  "APEX_EVIDENCE_GATE_MIN_WIN_RATE",
  "APEX_EVIDENCE_GATE_MIN_EXPECTANCY",
] as const;

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [latestRun, pendingAlerts, failedAlerts, recentProviderHealth] = await Promise.all([
    prisma.signalRun.findFirst({ orderBy: { queuedAt: "desc" } }),
    prisma.alert.count({ where: { status: "PENDING" } }),
    prisma.alert.count({ where: { status: "FAILED" } }),
    prisma.providerHealth.findMany({
      orderBy: { recordedAt: "desc" },
      take: 10,
      select: { provider: true, status: true, latencyMs: true, errorRate: true, recordedAt: true },
    }),
  ]);

  // Check which env vars are set (never expose values)
  const envStatus = Object.fromEntries(
    ENV_KEYS.map(key => [key, !!process.env[key]]),
  );

  // DB status
  let dbStatus = "OK";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    dbStatus = "ERROR";
  }

  const envChecks = {
    web: validateRuntimeEnv({ service: "web", strict: process.env.NODE_ENV === "production" }),
    worker: validateRuntimeEnv({ service: "worker", strict: process.env.NODE_ENV === "production" }),
    scheduler: validateRuntimeEnv({ service: "scheduler", strict: process.env.NODE_ENV === "production" }),
    backfill: validateRuntimeEnv({ service: "backfill", strict: process.env.NODE_ENV === "production" }),
  };

  return NextResponse.json({
    latestRun,
    queue: { pending: pendingAlerts, failed: failedAlerts },
    envStatus,
    envChecks,
    dbStatus,
    providerHealth: recentProviderHealth,
  });
}
