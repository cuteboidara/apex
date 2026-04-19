import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/requireAdmin";
import { prisma } from "@/lib/prisma";
import { fetchMacroContext } from "@/src/indices/data/fetchers/macroFetcher";

export const dynamic = "force-dynamic";

type AdminStatsRouteDependencies = {
  prisma: typeof prisma;
  requireAdmin: typeof requireAdmin;
  fetchMacroContextFn?: typeof fetchMacroContext;
};

function toRuntimeStatus(lastCycleAt: Date | null): "live" | "idle" | "error" {
  if (!lastCycleAt) return "idle";

  const elapsedMs = Date.now() - lastCycleAt.getTime();
  if (elapsedMs <= 30 * 60 * 1000) return "live";
  if (elapsedMs <= 4 * 60 * 60 * 1000) return "idle";
  return "error";
}

function getSetupType(row: { smcSetupJson: unknown }): string {
  const value = row.smcSetupJson;
  if (!value || typeof value !== "object") return "unknown";

  const setupType = (value as { setupType?: unknown }).setupType;
  return typeof setupType === "string" && setupType.trim().length > 0
    ? setupType
    : "unknown";
}

export function createAdminStatsRouteHandler(deps: AdminStatsRouteDependencies) {
  return async function GET() {
    const auth = await deps.requireAdmin();
    if (!auth.ok) return auth.response;

    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [
        totalSignals,
        executableSignals,
        watchlistSignals,
        signalScoreAvg,
        signalRows,
        latestCycle,
        assetsScanned,
        totalUsers,
        activeUsers,
        pendingApprovals,
        newUsersToday,
        macro,
      ] = await Promise.all([
        deps.prisma.indicesSignal.count(),
        deps.prisma.indicesSignal.count({ where: { totalScore: { gte: 60 } } }),
        deps.prisma.indicesSignal.count({ where: { totalScore: { gte: 40, lt: 60 } } }),
        deps.prisma.indicesSignal.aggregate({ _avg: { totalScore: true } }),
        deps.prisma.indicesSignal.findMany({
          select: {
            assetId: true,
            smcSetupJson: true,
          },
          orderBy: { createdAt: "desc" },
          take: 2000,
        }),
        deps.prisma.indicesSignal.findFirst({
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        deps.prisma.indicesAssetState.count(),
        deps.prisma.user.count(),
        deps.prisma.user.count({ where: { lastLoginAt: { gte: sevenDaysAgo } } }),
        deps.prisma.user.count({ where: { status: "PENDING" } }),
        deps.prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
        (deps.fetchMacroContextFn ?? fetchMacroContext)().catch(() => null),
      ]);

      const signalsByAsset: Record<string, number> = {};
      const signalsBySetup: Record<string, number> = {};

      for (const row of signalRows) {
        signalsByAsset[row.assetId] = (signalsByAsset[row.assetId] ?? 0) + 1;

        const setupType = getSetupType(row);
        signalsBySetup[setupType] = (signalsBySetup[setupType] ?? 0) + 1;
      }

      const lastCycleAt = latestCycle?.createdAt ?? null;

      return NextResponse.json({
        runtimeStatus: toRuntimeStatus(lastCycleAt),
        lastCycle: lastCycleAt?.toISOString() ?? null,
        cycleLatency: 0,
        assetsScanned,

        totalSignals,
        executableSignals,
        watchlistSignals,
        avgScore: signalScoreAvg._avg.totalScore ?? 0,
        signalsByAsset,
        signalsBySetup,

        totalUsers,
        activeUsers,
        pendingApprovals,
        newUsersToday,

        macroRegime: macro?.dxy?.trend ? String(macro.dxy.trend).toUpperCase() : "NORMAL",
        dxy: macro?.dxy?.price ?? 0,
        vix: macro?.vix?.price ?? 0,
        eventRisk: Array.isArray(macro?.economicEvents) ? macro.economicEvents.length : 0,
      });
    } catch (error) {
      console.error("[admin/stats] Failed to build command center stats:", error);
      return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
    }
  };
}

export const GET = createAdminStatsRouteHandler({
  prisma,
  requireAdmin,
});
