import { prisma } from "@/lib/prisma";
import { runFullCycle } from "@/lib/apexEngine";
import { sendSignal } from "@/lib/telegramService";
import { logEvent } from "@/lib/logging";
import { recordAuditEvent } from "@/lib/audit";
import { FAILURE_CODES } from "@/lib/runConfig";
import { ensureSignalRunRecord, updateSignalRunWithRecovery } from "@/lib/runLifecycle";

type RunCycleDependencies = {
  prisma: typeof prisma;
  runFullCycle: typeof runFullCycle;
  sendSignal: typeof sendSignal;
  recordAuditEvent: typeof recordAuditEvent;
  ensureSignalRunRecord: typeof ensureSignalRunRecord;
  updateSignalRunWithRecovery: typeof updateSignalRunWithRecovery;
};

export function createRunCycle(deps: RunCycleDependencies) {
  return async function runCycle(runId?: string | null) {
    const ensuredRun = await deps.ensureSignalRunRecord(runId, {
      status: "QUEUED",
      queuedAt: new Date(),
    });
    const effectiveRunId = ensuredRun.id;
    const { signals } = await deps.runFullCycle(effectiveRunId);
    const runRecord = await deps.prisma.signalRun.findUnique({
      where: { id: effectiveRunId },
      select: { startedAt: true, queuedAt: true },
    }).catch(() => null);

    logEvent({
      runId: effectiveRunId,
      component: "scheduler",
      message: "Alert dispatch starting",
      signalCount: signals.length,
    });

    const alertStartedAt = Date.now();
    let fired = 0;
    try {
      const alertSignals = signals.filter(s => s.rank === "S" || s.rank === "A" || s.rank === "B");
      const alertResults = await Promise.allSettled(alertSignals.map(s => deps.sendSignal(s)));
      fired = alertResults.filter(r => r.status === "fulfilled").length;
      for (const result of alertResults) {
        if (result.status === "rejected") {
          logEvent({
            runId: effectiveRunId,
            component: "scheduler",
            severity: "WARN",
            message: "Telegram alert failed",
            reason: String(result.reason),
          });
        }
      }
    } catch (err) {
      const failedAt = new Date();
      const baseline = runRecord?.startedAt ?? runRecord?.queuedAt ?? ensuredRun.startedAt ?? ensuredRun.queuedAt;
      await deps.updateSignalRunWithRecovery(effectiveRunId, {
        status: "FAILED",
        completedAt: failedAt,
        totalDurationMs: Math.max(0, failedAt.getTime() - baseline.getTime()),
        failureCode: FAILURE_CODES.ALERT_DELIVERY_ERROR,
        failureReason: String(err).slice(0, 1000),
      }, {
        id: effectiveRunId,
        queuedAt: ensuredRun.queuedAt,
        startedAt: ensuredRun.startedAt,
        status: "FAILED",
      });
      await deps.recordAuditEvent({
        actor: "SYSTEM",
        action: "run_failed",
        entityType: "SignalRun",
        entityId: effectiveRunId,
        after: { failureCode: FAILURE_CODES.ALERT_DELIVERY_ERROR },
        correlationId: effectiveRunId,
      });
      throw err;
    }

    const alertDispatchDurationMs = Date.now() - alertStartedAt;
    const completedAt = new Date();
    const baseline = runRecord?.startedAt ?? runRecord?.queuedAt ?? ensuredRun.startedAt ?? ensuredRun.queuedAt;
    await deps.updateSignalRunWithRecovery(effectiveRunId, {
      status: "COMPLETED",
      completedAt,
      totalDurationMs: Math.max(0, completedAt.getTime() - baseline.getTime()),
      alertDispatchDurationMs,
    }, {
      id: effectiveRunId,
      queuedAt: ensuredRun.queuedAt,
      startedAt: ensuredRun.startedAt,
      status: "COMPLETED",
    });

    logEvent({
      runId: effectiveRunId,
      component: "scheduler",
      message: "Cycle complete",
      alertsQueued: fired,
      analyzedAssets: signals.length,
      alertDispatchDurationMs,
    });
    await deps.recordAuditEvent({
      actor: "SYSTEM",
      action: "alerts_dispatched",
      entityType: "SignalRun",
      entityId: effectiveRunId,
      after: { alertDispatchDurationMs, alertsQueued: fired },
      correlationId: effectiveRunId,
    });
    return { runId: effectiveRunId, signals };
  };
}

export const runCycle = createRunCycle({
  prisma,
  runFullCycle,
  sendSignal,
  recordAuditEvent,
  ensureSignalRunRecord,
  updateSignalRunWithRecovery,
});
