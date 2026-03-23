/**
 * Combined scheduler + worker process.
 * Runs the BullMQ signal-cycle worker AND the cron scheduler in one process,
 * so a single Railway service handles both job enqueueing and processing.
 */
import "dotenv/config";

import cron from "node-cron";
import { Worker } from "bullmq";
import { printValidationReport, validateRuntimeEnv } from "./validate-env.mjs";

import { logEvent } from "../lib/logging";
import { enqueueSignalCycle, createRedisConnection, SIGNAL_CYCLE_QUEUE } from "../lib/queue";
import { runCycle } from "../lib/scheduler";
import { prisma } from "../lib/prisma";
import { recordAuditEvent } from "../lib/audit";
import { FAILURE_CODES } from "../lib/runConfig";

const validationReport = validateRuntimeEnv({
  service: "worker",
  strict: process.env.NODE_ENV === "production" || process.env.APEX_STRICT_STARTUP === "true",
});
printValidationReport(validationReport);
if (validationReport.errors.length > 0) {
  process.exit(1);
}

// ── Worker ────────────────────────────────────────────────────────────────────

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
    component: "worker-with-scheduler",
    message: "Signal cycle worker ready",
  });
});

worker.on("completed", (job, result) => {
  logEvent({
    component: "worker-with-scheduler",
    message: "Signal cycle job completed",
    jobId: job.id,
    runId: result.runId,
    signalCount: result.count,
  });
});

worker.on("failed", (job, err) => {
  const runId = typeof job?.data?.runId === "string" ? job.data.runId : null;
  logEvent({
    component: "worker-with-scheduler",
    severity: "ERROR",
    message: "Signal cycle job failed",
    jobId: job?.id,
    runId,
    reason: String(err),
  });
  if (runId) {
    void prisma.signalRun
      .update({
        where: { id: runId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          failureCode: FAILURE_CODES.UNKNOWN_ERROR,
          failureReason: String(err).slice(0, 1000),
        },
      })
      .then(() =>
        recordAuditEvent({
          actor: "SYSTEM",
          action: "run_failed",
          entityType: "SignalRun",
          entityId: runId,
          after: { status: "FAILED", failureCode: FAILURE_CODES.UNKNOWN_ERROR },
          correlationId: runId,
        })
      )
      .catch(updateErr => {
        logEvent({
          component: "worker-with-scheduler",
          severity: "ERROR",
          message: "Failed to persist worker failure state",
          runId,
          reason: String(updateErr),
        });
      });
  }
});

// ── Scheduler ─────────────────────────────────────────────────────────────────

async function scheduleCycle(trigger: string) {
  try {
    const { job, runId } = await enqueueSignalCycle(undefined, {
      actor: "SYSTEM",
      correlationId: null,
    });
    logEvent({
      component: "worker-with-scheduler",
      message: "Signal cycle enqueued",
      trigger,
      jobId: job.id,
      runId,
      queue: job.queueName,
    });
  } catch (err) {
    logEvent({
      component: "worker-with-scheduler",
      severity: "ERROR",
      message: "Failed to enqueue signal cycle",
      trigger,
      reason: String(err),
    });
  }
}

// Enqueue one cycle immediately on startup, then every 15 minutes
void scheduleCycle("startup");

cron.schedule("*/15 * * * *", () => {
  void scheduleCycle("cron");
});

logEvent({
  component: "worker-with-scheduler",
  message: "Worker + scheduler started",
  cron: "*/15 * * * *",
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await worker.close();
    process.exit(0);
  });
}
