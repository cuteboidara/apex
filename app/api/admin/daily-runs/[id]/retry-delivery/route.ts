import { NextRequest, NextResponse } from "next/server";

import { retryDailySignalDelivery } from "@/src/application/signals/retryDailySignalDelivery";
import { DailySignalDeliveryRepository } from "@/src/infrastructure/persistence/dailySignalDeliveryRepository";
import { DailySignalRunRepository } from "@/src/infrastructure/persistence/dailySignalRunRepository";
import {
  buildAdminDailyRunView,
  requireAdminOrOperatorAccess,
} from "@/src/presentation/api/admin/dailyRuns";

export const dynamic = "force-dynamic";

type RetryDeliveryBody = {
  deliveryId?: string;
};

type RetryDeliveryRouteDependencies = {
  requireAccess?: typeof requireAdminOrOperatorAccess;
  createRunRepository?: () => DailySignalRunRepository;
  createDeliveryRepository?: () => DailySignalDeliveryRepository;
  retryDelivery?: typeof retryDailySignalDelivery;
};

export function createRetryDailySignalDeliveryRouteHandler(
  deps: RetryDeliveryRouteDependencies = {},
) {
  return async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) {
    const auth = await (deps.requireAccess ?? requireAdminOrOperatorAccess)();
    if (!auth.ok) {
      return auth.response;
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({} as RetryDeliveryBody));
    const deliveryId = typeof body.deliveryId === "string" ? body.deliveryId.trim() : "";

    if (!deliveryId) {
      return NextResponse.json(
        {
          error: "Expected { deliveryId: string }",
        },
        { status: 400 },
      );
    }

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

      const delivery = await deliveryRepository.findById(deliveryId);
      if (!delivery || delivery.runId !== run.id) {
        return NextResponse.json(
          {
            error: "Daily run delivery not found",
          },
          { status: 404 },
        );
      }

      const retriedDelivery = await (deps.retryDelivery ?? retryDailySignalDelivery)(delivery.id, {
        runRepository,
        deliveryRepository,
      });
      const deliveries = await deliveryRepository.listByRunId(run.id);
      const refreshedRun = await runRepository.findById(run.id);

      if (!refreshedRun) {
        return NextResponse.json(
          {
            error: "Daily run not found after retry",
          },
          { status: 404 },
        );
      }

      return NextResponse.json({
        success: true,
        delivery: {
          id: retriedDelivery.id,
          channel: retriedDelivery.channel,
          target: retriedDelivery.target,
          status: retriedDelivery.status,
          attempts: retriedDelivery.attempts,
          explicitRetry: retriedDelivery.explicitRetry,
          providerMessageId: retriedDelivery.providerMessageId,
          errorMessage: retriedDelivery.errorMessage,
          lastAttemptAt: retriedDelivery.lastAttemptAt?.toISOString() ?? null,
          deliveredAt: retriedDelivery.deliveredAt?.toISOString() ?? null,
          createdAt: retriedDelivery.createdAt.toISOString(),
          updatedAt: retriedDelivery.updatedAt.toISOString(),
        },
        run: buildAdminDailyRunView(refreshedRun, deliveries),
      });
    } catch (error) {
      console.error("[admin/daily-runs/:id/retry-delivery] Failed to retry delivery:", error);
      return NextResponse.json(
        {
          success: false,
          error: String(error),
        },
        { status: 500 },
      );
    }
  };
}

export const POST = createRetryDailySignalDeliveryRouteHandler();
