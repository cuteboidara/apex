import { NextResponse } from "next/server";

import { DailySignalDeliveryRepository } from "@/src/infrastructure/persistence/dailySignalDeliveryRepository";
import { DailySignalRunRepository } from "@/src/infrastructure/persistence/dailySignalRunRepository";
import {
  buildAdminDailyRunView,
  requireAdminOrOperatorAccess,
} from "@/src/presentation/api/admin/dailyRuns";

export const dynamic = "force-dynamic";

type AdminDailyRunDetailRouteDependencies = {
  requireAccess?: typeof requireAdminOrOperatorAccess;
  createRunRepository?: () => DailySignalRunRepository;
  createDeliveryRepository?: () => DailySignalDeliveryRepository;
};

export function createAdminDailyRunDetailRouteHandler(
  deps: AdminDailyRunDetailRouteDependencies = {},
) {
  return async function GET(
    _request: Request,
    context: { params: Promise<{ id: string }> },
  ) {
    const auth = await (deps.requireAccess ?? requireAdminOrOperatorAccess)();
    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await context.params;
    const runRepository = (deps.createRunRepository ?? (() => new DailySignalRunRepository()))();
    const deliveryRepository = (deps.createDeliveryRepository ?? (() => new DailySignalDeliveryRepository()))();

    try {
      const run = await runRepository.findById(id);
      if (!run) {
        return NextResponse.json(
          {
            error: "Daily run not found",
          },
          { status: 404 },
        );
      }

      const deliveries = await deliveryRepository.listByRunId(run.id);

      return NextResponse.json({
        run: buildAdminDailyRunView(run, deliveries),
      });
    } catch (error) {
      console.error("[admin/daily-runs/:id] Failed to read daily run:", error);
      return NextResponse.json(
        {
          error: "Failed to read daily run",
        },
        { status: 500 },
      );
    }
  };
}

export const GET = createAdminDailyRunDetailRouteHandler();
