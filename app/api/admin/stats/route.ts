import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    totalUsers,
    pendingUsers,
    activeToday,
    bannedUsers,
    totalSignals,
    bSignals,
    aSignals,
    sSignals,
    recentUsers,
    recentSignals,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.user.count({ where: { lastLoginAt: { gte: todayStart } } }),
    prisma.user.count({ where: { status: "BANNED" } }),
    prisma.signal.count(),
    prisma.signal.count({ where: { rank: "B" } }),
    prisma.signal.count({ where: { rank: "A" } }),
    prisma.signal.count({ where: { rank: "S" } }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, name: true, email: true, status: true, createdAt: true },
    }),
    prisma.signal.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, asset: true, direction: true, rank: true, total: true, createdAt: true },
    }),
  ]);

  return NextResponse.json({
    users: { total: totalUsers, pending: pendingUsers, activeToday, banned: bannedUsers },
    signals: { total: totalSignals, b: bSignals, a: aSignals, s: sSignals },
    recentUsers,
    recentSignals,
  });
}
