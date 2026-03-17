import "dotenv/config";

import cron from "node-cron";

import { logEvent } from "../lib/logging";
import { enqueueSignalCycle } from "../lib/queue";

async function scheduleCycle(trigger: string) {
  try {
    const { job, runId } = await enqueueSignalCycle(undefined, {
      actor: "SYSTEM",
      correlationId: null,
    });
    logEvent({
      component: "scheduler-service",
      message: "Signal cycle enqueued",
      trigger,
      jobId: job.id,
      runId,
      queue: job.queueName,
    });
  } catch (err) {
    logEvent({
      component: "scheduler-service",
      severity: "ERROR",
      message: "Failed to enqueue signal cycle",
      trigger,
      reason: String(err),
    });
  }
}

void scheduleCycle("startup");

cron.schedule("*/15 * * * *", () => {
  void scheduleCycle("cron");
});

logEvent({
  component: "scheduler-service",
  message: "Scheduler service started",
  cron: "*/15 * * * *",
});
