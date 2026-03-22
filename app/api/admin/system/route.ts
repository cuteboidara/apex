import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const dynamic = "force-dynamic";

const ENV_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "UPSTASH_REDIS_REST_URL",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "NEWS_API_KEY",
  "FRED_API_KEY",
  "TWELVE_DATA_API_KEY",
  "RESEND_API_KEY",
  "NEXTAUTH_SECRET",
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

  return NextResponse.json({
    latestRun,
    queue: { pending: pendingAlerts, failed: failedAlerts },
    envStatus,
    dbStatus,
    providerHealth: recentProviderHealth,
  });
}
