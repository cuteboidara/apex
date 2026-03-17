import "dotenv/config";

import { Worker } from "bullmq";

import { logEvent } from "../lib/logging";
import { createRedisConnection, SIGNAL_CYCLE_QUEUE } from "../lib/queue";
import { runCycle } from "../lib/scheduler";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { FAILURE_CODES } from "../lib/runConfig";

const connection = createRedisConnection();

const worker = new Worker(
  SIGNAL_CYCLE_QUEUE,
  async job => {
    const runId = String(job.data.runId);
    const { signals } = await runCycle(runId);
    return { runId, count: signals.length };
  },
  {
    connection,
    concurrency: 1,
  }
);

worker.on("ready", () => {
  logEvent({
    component: "signal-cycle-worker",
    message: "Signal cycle worker ready",
  });
});

worker.on("completed", (job, result) => {
  logEvent({
    component: "signal-cycle-worker",
    message: "Signal cycle job completed",
    jobId: job.id,
    runId: result.runId,
    signalCount: result.count,
  });
});

worker.on("failed", (job, err) => {
  const runId = typeof job?.data?.runId === "string" ? job.data.runId : null;
  logEvent({
    component: "signal-cycle-worker",
    severity: "ERROR",
    message: "Signal cycle job failed",
    jobId: job?.id,
    runId,
    reason: String(err),
  });
  if (runId) {
    void prisma.signalRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        failureCode: FAILURE_CODES.UNKNOWN_ERROR,
        failureReason: String(err).slice(0, 1000),
      },
    }).then(() => recordAuditEvent({
      actor: "SYSTEM",
      action: "run_failed",
      entityType: "SignalRun",
      entityId: runId,
      after: {
        status: "FAILED",
        failureCode: FAILURE_CODES.UNKNOWN_ERROR,
      },
      correlationId: runId,
    })).catch(updateErr => {
      logEvent({
        component: "signal-cycle-worker",
        severity: "ERROR",
        message: "Failed to persist worker failure state",
        runId,
        reason: String(updateErr),
      });
    });
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await worker.close();
    process.exit(0);
  });
}
