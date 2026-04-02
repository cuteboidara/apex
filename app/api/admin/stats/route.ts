import { NextResponse } from "next/server";

import { buildRouteErrorResponse } from "@/lib/api/routeErrors";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type AdminStatsRouteDependencies = {
  prisma: typeof prisma;
  requireAdmin: typeof requireAdmin;
};

const EMPTY_ADMIN_STATS = {
  ok: true,
  users: { total: 0, pending: 0, activeToday: 0, banned: 0 },
  signals: { total: 0, b: 0, a: 0, s: 0 },
  recentUsers: [] as Array<{ id: string; name: string | null; email: string; status: string; createdAt: Date }>,
  recentSignals: [] as Array<{ id: string; asset: string; direction: string; rank: string; total: number; createdAt: Date }>,
};

export function createAdminStatsRouteHandler(deps: AdminStatsRouteDependencies) {
  return async function GET() {
    try {
      const auth = await deps.requireAdmin();
      if (!auth.ok) return auth.response;

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [
        totalUsers,
        pendingUsers,
        activeToday,
        bannedUsers,
        recentUsers,
        totalSignals,
        bSignals,
        aSignals,
        sSignals,
        recentSignals,
      ] = await Promise.all([
        deps.prisma.user.count().catch(() => 0),
        deps.prisma.user.count({ where: { status: "PENDING" } }).catch(() => 0),
        deps.prisma.user.count({ where: { lastLoginAt: { gte: todayStart } } }).catch(() => 0),
        deps.prisma.user.count({ where: { status: "BANNED" } }).catch(() => 0),
        deps.prisma.user.findMany({
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, name: true, email: true, status: true, createdAt: true },
        }).catch(() => []),
        deps.prisma.signal.count().catch(() => 0),
        deps.prisma.signal.count({ where: { rank: "B" } }).catch(() => 0),
        deps.prisma.signal.count({ where: { rank: "A" } }).catch(() => 0),
        deps.prisma.signal.count({ where: { rank: { in: ["S", "S+"] } } }).catch(() => 0),
        deps.prisma.signal.findMany({
          orderBy: { createdAt: "desc" },
          take: 10,
          select: {
            id: true,
            asset: true,
            direction: true,
            rank: true,
            total: true,
            createdAt: true,
          },
        }).catch(() => []),
      ]);

      return NextResponse.json({
        ok: true,
        users: {
          total: totalUsers ?? 0,
          pending: pendingUsers ?? 0,
          activeToday: activeToday ?? 0,
          banned: bannedUsers ?? 0,
        },
        signals: {
          total: totalSignals ?? 0,
          b: bSignals ?? 0,
          a: aSignals ?? 0,
          s: sSignals ?? 0,
        },
        recentUsers: Array.isArray(recentUsers) ? recentUsers : EMPTY_ADMIN_STATS.recentUsers,
        recentSignals: Array.isArray(recentSignals) ? recentSignals : EMPTY_ADMIN_STATS.recentSignals,
      });
    } catch (error) {
      return buildRouteErrorResponse(error, {
        publicMessage: "Unable to load admin overview stats.",
      });
    }
  };
}

export const GET = createAdminStatsRouteHandler({
  prisma,
  requireAdmin,
});
