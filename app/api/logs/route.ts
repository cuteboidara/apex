import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { setupId, entry, exit, pnl, notes, outcome } = await req.json();

  const log = await prisma.tradeLog.create({
    data: { setupId, entry, exit, pnl, notes, outcome },
  });

  return NextResponse.json(log, { status: 201 });
}

export async function GET() {
  const logs = await prisma.tradeLog.findMany({
    include: { setup: true },
    orderBy: { id: "desc" },
  });

  return NextResponse.json(logs);
}
