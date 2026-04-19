import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/requireAdmin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function parseSetupType(value: unknown): string {
  if (!value || typeof value !== "object") return "unknown";

  const setupType = (value as { setupType?: unknown }).setupType;
  return typeof setupType === "string" && setupType.trim().length > 0
    ? setupType
    : "unknown";
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const searchParams = req.nextUrl.searchParams;
  const limitRaw = Number(searchParams.get("limit") ?? 500);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, Math.trunc(limitRaw))) : 500;

  const rows = await prisma.indicesSignal.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      assetId: true,
      direction: true,
      totalScore: true,
      entryZoneHigh: true,
      entryZoneLow: true,
      entryZoneMid: true,
      stopLoss: true,
      tp1: true,
      riskRewardRatio: true,
      createdAt: true,
      smcSetupJson: true,
    },
  });

  return NextResponse.json({
    signals: rows.map(row => ({
      id: row.id,
      assetId: row.assetId,
      setupType: parseSetupType(row.smcSetupJson),
      direction: row.direction,
      score: row.totalScore,
      entryZone: {
        high: row.entryZoneHigh,
        low: row.entryZoneLow,
        mid: row.entryZoneMid,
      },
      stopLoss: row.stopLoss,
      tp1: row.tp1,
      riskRewardRatio: row.riskRewardRatio,
      createdAt: row.createdAt.toISOString(),
    })),
  });
}
