import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureTradePlansForRun } from "@/lib/tradePlanPersistence";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    await ensureTradePlansForRun(id);

    const run = await prisma.signalRun.findUnique({
      where: { id },
      include: {
        tradePlans: {
          orderBy: [
            { symbol: "asc" },
            { style: "asc" },
          ],
        },
        signals: {
          orderBy: { total: "desc" },
          include: {
            alerts: {
              orderBy: { createdAt: "desc" },
            },
          },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    return NextResponse.json(run);
  } catch {
    return NextResponse.json({ error: "Run detail unavailable" }, { status: 503 });
  }
}
