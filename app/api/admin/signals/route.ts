import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const asset  = searchParams.get("asset");
  const rank   = searchParams.get("rank");
  const from   = searchParams.get("from");
  const to     = searchParams.get("to");
  const limit  = Math.min(parseInt(searchParams.get("limit") ?? "50"), 200);

  const where: Record<string, unknown> = {};
  if (asset) where.asset = asset;
  if (rank)  where.rank  = rank;
  if (from || to) {
    where.createdAt = {};
    if (from) (where.createdAt as Record<string, unknown>).gte = new Date(from);
    if (to)   (where.createdAt as Record<string, unknown>).lte = new Date(to);
  }

  const signals = await prisma.signal.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      tradePlans: {
        select: { style: true, bias: true, confidence: true, entryMin: true, entryMax: true, stopLoss: true, takeProfit1: true, takeProfit2: true, takeProfit3: true },
      },
    },
  });

  return NextResponse.json(signals);
}
