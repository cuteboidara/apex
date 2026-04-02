import { NextRequest, NextResponse } from "next/server";

import { DailySignalDeliveryRepository } from "@/src/infrastructure/persistence/dailySignalDeliveryRepository";
import { DailySignalRunRepository } from "@/src/infrastructure/persistence/dailySignalRunRepository";
import {
  buildAdminDailyRunView,
  requireAdminOrOperatorAccess,
} from "@/src/presentation/api/admin/dailyRuns";

export const dynamic = "force-dynamic";

type AdminDailyRunsRouteDependencies = {
  requireAccess?: typeof requireAdminOrOperatorAccess;
  createRunRepository?: () => DailySignalRunRepository;
  createDeliveryRepository?: () => DailySignalDeliveryRepository;
};

export function createAdminDailyRunsRouteHandler(
  deps: AdminDailyRunsRouteDependencies = {},
) {
  return async function GET(request: NextRequest) {
    const auth = await (deps.requireAccess ?? requireAdminOrOperatorAccess)();
    if (!auth.ok) {
      return auth.response;
    }

    const { searchParams } = new URL(request.url);
    const parsedLimit = Number.parseInt(searchParams.get("limit") ?? "20", 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.max(1, Math.min(parsedLimit, 100))
      : 20;

    try {
      const runRepository = (deps.createRunRepository ?? (() => new DailySignalRunRepository()))();
      const deliveryRepository = (deps.createDeliveryRepository ?? (() => new DailySignalDeliveryRepository()))();
      const runs = await runRepository.listRecent(limit);

      const items = await Promise.all(runs.map(async run => {
        const deliveries = await deliveryRepository.listByRunId(run.id);
        return buildAdminDailyRunView(run, deliveries);
      }));

      return NextResponse.json({
        runs: items,
        limit,
      });
    } catch (error) {
      console.error("[admin/daily-runs] Failed to list daily runs:", error);
      return NextResponse.json(
        {
          error: "Failed to list daily runs",
        },
        { status: 500 },
      );
    }
  };
}

export const GET = createAdminDailyRunsRouteHandler();
