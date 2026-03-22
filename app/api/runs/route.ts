import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { reconcileStaleRuns } from "@/lib/runLifecycle";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await reconcileStaleRuns();
    const runs = await prisma.signalRun.findMany({
      orderBy: { queuedAt: "desc" },
      take: 12,
      include: {
        _count: {
          select: { signals: true },
        },
      },
    });

    const failureBreakdown = runs.reduce<Record<string, number>>(
      (
        acc: Record<string, number>,
        run: { failureCode?: string | null }
      ) => {
        const key = run.failureCode ?? "NONE";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      },
      {}
    );

    return NextResponse.json({ runs, failureBreakdown });
  } catch {
    return NextResponse.json({ runs: [], failureBreakdown: {} });
  }
}
