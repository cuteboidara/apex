import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SUPPORTED_ASSETS, TRADE_PLAN_STYLES } from "@/lib/assets";
import { ensureTradePlansForRuns } from "@/lib/tradePlanPersistence";
import { buildLatestSetupBreakdown } from "@/lib/setupBreakdown";
import { refreshTradePlanDiagnostics } from "@/lib/tradePlanDiagnostics";

export async function GET() {
  type TradePlanRecord = Awaited<ReturnType<typeof prisma.tradePlan.findFirst>>;
  type SignalRunIdRecord = { id: string };

  const latestRuns = await prisma.signalRun.findMany({
    where: { status: "COMPLETED" },
    orderBy: { completedAt: "desc" },
    take: 5,
    select: { id: true },
  });

  const runIds = latestRuns.map((run: SignalRunIdRecord) => run.id);
  await ensureTradePlansForRuns(runIds);
  await refreshTradePlanDiagnostics({ runIds });

  const grouped = await Promise.all(
    SUPPORTED_ASSETS.flatMap(asset =>
      TRADE_PLAN_STYLES.map(style =>
        prisma.tradePlan.findFirst({
          where: {
            symbol: asset.symbol,
            style,
            run: { status: "COMPLETED" },
          },
          orderBy: [
            { run: { completedAt: "desc" } },
            { createdAt: "desc" },
          ],
        })
      )
    )
  );

  const payload: Record<string, Record<string, unknown>> = {};
  grouped.forEach((plan: TradePlanRecord) => {
    if (!plan) return;
    if (!payload[plan.symbol]) payload[plan.symbol] = {};
    payload[plan.symbol][plan.style] = plan;
  });

  const plans = grouped.filter((plan: TradePlanRecord | null | undefined): plan is NonNullable<TradePlanRecord> => Boolean(plan));

  return NextResponse.json({
    runId: latestRuns[0]?.id ?? null,
    plans: payload,
    breakdown: buildLatestSetupBreakdown(plans),
    timestamp: new Date().toISOString(),
  });
}
