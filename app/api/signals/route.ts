import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const asset  = searchParams.get("asset") ?? undefined;
  const rank   = searchParams.get("rank")  ?? undefined;
  const limit  = Math.min(200, parseInt(searchParams.get("limit") ?? "50") || 50);

  // Build rank filter — supports comma-separated e.g. "A,S"
  const rankFilter = rank
    ? { in: rank.split(",").map(r => r.trim()) }
    : undefined;

  const signals = await prisma.signal.findMany({
    where: {
      run: { status: "COMPLETED" },
      ...(asset       ? { asset }                  : {}),
      ...(rankFilter  ? { rank: rankFilter }        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(signals);
}
