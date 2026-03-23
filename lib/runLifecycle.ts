import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logging";
import { recordAuditEvent } from "@/lib/audit";
import { FAILURE_CODES } from "@/lib/runConfig";

const STALE_RUN_THRESHOLD_MS = 5 * 60 * 1000; // 300 000 ms — matches Railway maxDuration

function getRunAgeMs(run: { startedAt: Date | null; queuedAt: Date }) {
  const baseline = run.startedAt ?? run.queuedAt;
  return Date.now() - baseline.getTime();
}

export async function reconcileStaleRuns() {
  const activeRuns = await prisma.signalRun.findMany({
    where: {
      status: {
        in: ["QUEUED", "RUNNING"],
      },
      completedAt: null,
    },
    select: {
      id: true,
      status: true,
      queuedAt: true,
      startedAt: true,
    },
  });

  const staleRuns = activeRuns.filter(run => getRunAgeMs(run) > STALE_RUN_THRESHOLD_MS);

  for (const run of staleRuns) {
    const baseline = run.startedAt ?? run.queuedAt;
    const totalDurationMs = Math.max(0, Date.now() - baseline.getTime());
    const failureReason = `Run reconciled after exceeding ${STALE_RUN_THRESHOLD_MS}ms without completion`;

    await prisma.signalRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        totalDurationMs,
        failureCode: FAILURE_CODES.UNKNOWN_ERROR,
        failureReason,
        failureDetails: [
          {
            failureCode: FAILURE_CODES.UNKNOWN_ERROR,
            reason: failureReason,
          },
        ],
      },
    });

    logEvent({
      runId: run.id,
      component: "run-lifecycle",
      severity: "WARN",
      message: "Stale run reconciled to FAILED",
      previousStatus: run.status,
      totalDurationMs,
    });

    await recordAuditEvent({
      actor: "SYSTEM",
      action: "run_reconciled",
      entityType: "SignalRun",
      entityId: run.id,
      before: {
        status: run.status,
        startedAt: run.startedAt?.toISOString() ?? null,
        queuedAt: run.queuedAt.toISOString(),
      },
      after: {
        status: "FAILED",
        failureCode: FAILURE_CODES.UNKNOWN_ERROR,
        totalDurationMs,
      },
      correlationId: run.id,
    });
  }

  return staleRuns.length;
}
