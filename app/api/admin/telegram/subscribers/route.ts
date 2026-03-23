import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const [subscribers, total, active] = await Promise.all([
    prisma.telegramSubscriber.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        chatId: true,
        username: true,
        firstName: true,
        lastName: true,
        tier: true,
        status: true,
        alertsEnabled: true,
        alertAssets: true,
        alertRanks: true,
        messageCount: true,
        startedAt: true,
        lastActiveAt: true,
        createdAt: true,
      },
    }),
    prisma.telegramSubscriber.count(),
    prisma.telegramSubscriber.count({ where: { status: "ACTIVE" } }),
  ]);

  return NextResponse.json({ subscribers, total, active });
}
