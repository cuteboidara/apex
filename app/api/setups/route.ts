import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { asset, direction, rank, total, macro, structure, zones, technical, timing, reasoning } = body;

  const setup = await prisma.setup.create({
    data: { asset, direction, rank, total, macro, structure, zones, technical, timing, reasoning },
  });

  return NextResponse.json(setup, { status: 201 });
}

export async function GET() {
  const setups = await prisma.setup.findMany({
    include: { tradeLog: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(setups);
}
