import { runFullCycle } from "@/lib/apexEngine";
import { sendSignal } from "@/lib/telegramService";
import { logEvent } from "@/lib/logging";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit";
import { FAILURE_CODES } from "@/lib/runConfig";

// ── Cycle ─────────────────────────────────────────────────────────────────────

export async function runCycle(runId: string) {
  const { signals } = await runFullCycle(runId);
  const runRecord = await prisma.signalRun.findUnique({
    where: { id: runId },
    select: { startedAt: true, queuedAt: true },
  });
  logEvent({
    runId,
    component: "scheduler",
    message: "Alert dispatch starting",
    signalCount: signals.length,
  });

  // Send Telegram for A and S rank
  const alertStartedAt = Date.now();
  let fired = 0;
  try {
    for (const signal of signals) {
      if (signal.rank === "S" || signal.rank === "A") {
        await sendSignal(signal);
        fired += 1;
      }
    }
  } catch (err) {
    const failedAt = new Date();
    const baseline = runRecord?.startedAt ?? runRecord?.queuedAt ?? failedAt;
    await prisma.signalRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        completedAt: failedAt,
        totalDurationMs: Math.max(0, failedAt.getTime() - baseline.getTime()),
        failureCode: FAILURE_CODES.ALERT_DELIVERY_ERROR,
        failureReason: String(err).slice(0, 1000),
      },
    });
    await recordAuditEvent({
      actor: "SYSTEM",
      action: "run_failed",
      entityType: "SignalRun",
      entityId: runId,
      after: { failureCode: FAILURE_CODES.ALERT_DELIVERY_ERROR },
      correlationId: runId,
    });
    throw err;
  }
  const alertDispatchDurationMs = Date.now() - alertStartedAt;
  const completedAt = new Date();
  const baseline = runRecord?.startedAt ?? runRecord?.queuedAt ?? completedAt;
  await prisma.signalRun.update({
    where: { id: runId },
    data: {
      status: "COMPLETED",
      completedAt,
      totalDurationMs: Math.max(0, completedAt.getTime() - baseline.getTime()),
      alertDispatchDurationMs,
    },
  });

  logEvent({
    runId,
    component: "scheduler",
    message: "Cycle complete",
    alertsQueued: fired,
    analyzedAssets: signals.length,
    alertDispatchDurationMs,
  });
  await recordAuditEvent({
    actor: "SYSTEM",
    action: "alerts_dispatched",
    entityType: "SignalRun",
    entityId: runId,
    after: { alertDispatchDurationMs, alertsQueued: fired },
    correlationId: runId,
  });
  return { runId, signals };
}
