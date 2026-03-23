import "dotenv/config";

import { Worker } from "bullmq";
import { printValidationReport, validateRuntimeEnv } from "./validate-env.mjs";

import { logEvent } from "../lib/logging";
import { createRedisConnection, SIGNAL_CYCLE_QUEUE } from "../lib/queue";
import { persistDeadLetterJob } from "../lib/queue/deadLetter";
import { runCycle } from "../lib/scheduler";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { recordOperationalMetric } from "../lib/observability/metrics";
import { FAILURE_CODES } from "../lib/runConfig";

const validationReport = validateRuntimeEnv({
  service: "worker",
  strict: process.env.NODE_ENV === "production" || process.env.APEX_STRICT_STARTUP === "true",
});
printValidationReport(validationReport);
if (validationReport.errors.length > 0) {
  process.exit(1);
}

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
  const queuedAt = typeof job.data?.requestedAt === "string" ? Date.parse(job.data.requestedAt) : NaN;
  const lagMs = Number.isFinite(queuedAt) ? Math.max(0, Date.now() - queuedAt) : null;
  logEvent({
    component: "signal-cycle-worker",
    message: "Signal cycle job completed",
    jobId: job.id,
    runId: result.runId,
    signalCount: result.count,
  });
  void recordOperationalMetric({
    metric: "cycle_completed",
    category: "queue",
    severity: "INFO",
    count: 1,
    runId: result.runId,
    value: lagMs,
    unit: "ms",
    detail: "Signal cycle worker completed job",
    tags: {
      queueName: job.queueName,
      jobId: String(job.id),
      signalCount: result.count,
    },
  });
});

worker.on("failed", (job, err) => {
  const runId = typeof job?.data?.runId === "string" ? job.data.runId : null;
  const correlationId = typeof job?.data?.correlationId === "string" ? job.data.correlationId : runId;
  logEvent({
    component: "signal-cycle-worker",
    severity: "ERROR",
    message: "Signal cycle job failed",
    jobId: job?.id,
    runId,
    reason: String(err),
  });
  void persistDeadLetterJob({
    queueName: job?.queueName ?? SIGNAL_CYCLE_QUEUE,
    jobId: String(job?.id ?? `${SIGNAL_CYCLE_QUEUE}-unknown`),
    runId,
    attemptsMade: job?.attemptsMade ?? 0,
    reason: String(err),
    payload: (job?.data ?? null) as Record<string, unknown> | null,
    correlationId,
    metadata: {
      failedReason: job?.failedReason ?? null,
      stacktrace: err instanceof Error ? err.stack ?? null : null,
    },
  });
  void recordOperationalMetric({
    metric: "cycle_failed",
    category: "queue",
    severity: "ERROR",
    count: 1,
    runId,
    detail: String(err).slice(0, 500),
    tags: {
      queueName: job?.queueName ?? SIGNAL_CYCLE_QUEUE,
      jobId: String(job?.id ?? "unknown"),
      attemptsMade: job?.attemptsMade ?? 0,
    },
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
      correlationId,
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
