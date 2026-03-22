import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureTradePlansForRun, ensureTradePlansForRuns } from "@/lib/tradePlanPersistence";
import { refreshTradePlanDiagnostics } from "@/lib/tradePlanDiagnostics";

export async function GET(req: NextRequest) {
  type SignalRunIdRecord = { id: string };
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol") ?? undefined;
  const runId = searchParams.get("runId") ?? undefined;
  const style = searchParams.get("style") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const limit = Math.min(200, parseInt(searchParams.get("limit") ?? "50", 10) || 50);

  if (runId) {
    await ensureTradePlansForRun(runId);
    await refreshTradePlanDiagnostics({ runIds: [runId] });
  } else {
    const latestRuns = await prisma.signalRun.findMany({
      where: { status: "COMPLETED" },
      orderBy: { completedAt: "desc" },
      take: 5,
      select: { id: true },
    });
    const runIds = latestRuns.map((run: SignalRunIdRecord) => run.id);
    await ensureTradePlansForRuns(runIds);
    await refreshTradePlanDiagnostics({ runIds });
  }

  const tradePlans = await prisma.tradePlan.findMany({
    where: {
      run: { status: "COMPLETED" },
      ...(symbol ? { symbol } : {}),
      ...(runId ? { runId } : {}),
      ...(style ? { style } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json(tradePlans);
}
