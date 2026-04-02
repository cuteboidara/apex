import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { recordAuditEvent } from "@/lib/audit";
import { logEvent } from "@/lib/logging";
import { prisma } from "@/lib/prisma";
import { ENGINE_VERSION, FEATURE_VERSION, PROMPT_VERSION } from "@/lib/runConfig";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getApexRuntime } from "@/src/application/cycle/buildRuntime";
import { queueFocusedRuntimeCycle } from "@/src/application/cycle/runCycle";

type AdminTriggerCycleRouteDependencies = {
  requireAdmin: typeof requireAdmin;
  prisma: typeof prisma;
  recordAuditEvent: typeof recordAuditEvent;
  logEvent: typeof logEvent;
  getRuntime: typeof getApexRuntime;
  queueCycle: typeof queueFocusedRuntimeCycle;
};

export function createAdminTriggerCycleRouteHandler(deps: AdminTriggerCycleRouteDependencies) {
  return async function POST() {
    const auth = await deps.requireAdmin();
    if (!auth.ok) return auth.response;

    const queuedAt = new Date();
    const run = await deps.prisma.signalRun.create({
      data: {
        queuedAt,
        engineVersion: ENGINE_VERSION,
        featureVersion: FEATURE_VERSION,
        promptVersion: PROMPT_VERSION,
        status: "QUEUED",
      },
    });

    try {
      await deps.recordAuditEvent({
        actor: "OPERATOR",
        action: "manual_trigger",
        entityType: "SignalRun",
        entityId: run.id,
        after: { status: "QUEUED" },
        correlationId: run.id,
      });

      const runtime = deps.getRuntime();
      const queued = await deps.queueCycle(runtime, "admin");

      if (queued.queued) {
        return NextResponse.json({
          success: true,
          runId: run.id,
          signalCount: 0,
          status: "QUEUED",
          queued: true,
          jobId: queued.jobId ?? null,
          mode: runtime.config.mode,
        });
      }

      const completedAt = new Date();
      await deps.prisma.signalRun.update({
        where: { id: run.id },
        data: {
          startedAt: queuedAt,
          completedAt,
          totalDurationMs: Math.max(0, completedAt.getTime() - queuedAt.getTime()),
          status: "COMPLETED",
        },
      });

      return NextResponse.json({
        success: true,
        runId: run.id,
        signalCount: queued.result?.symbols.length ?? 0,
        status: "COMPLETED",
        queued: false,
        mode: runtime.config.mode,
        cycleId: queued.result?.cycle_id ?? null,
      });
    } catch (error) {
      const failedAt = new Date();
      await deps.prisma.signalRun.update({
        where: { id: run.id },
        data: {
          completedAt: failedAt,
          totalDurationMs: Math.max(0, failedAt.getTime() - queuedAt.getTime()),
          status: "FAILED",
          failureReason: String(error).slice(0, 1000),
        },
      }).catch(() => undefined);

      deps.logEvent({
        runId: run.id,
        component: "control-plane",
        severity: "ERROR",
        message: "Manual trigger cycle failed",
        reason: String(error),
      });

      return NextResponse.json(
        {
          success: false,
          runId: run.id,
          error: String(error),
        },
        { status: 500 },
      );
    }
  };
}

export const POST = createAdminTriggerCycleRouteHandler({
  requireAdmin,
  prisma,
  recordAuditEvent,
  logEvent,
  getRuntime: getApexRuntime,
  queueCycle: queueFocusedRuntimeCycle,
});
