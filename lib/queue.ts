import { JobsOptions, Queue } from "bullmq";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit";
import { ENGINE_VERSION, FEATURE_VERSION, PROMPT_VERSION } from "@/lib/runConfig";
import { createRedisConnectionOptions, getRedisConfiguration, isRedisConfigured } from "@/lib/runtime/redis";

export const SIGNAL_CYCLE_QUEUE = "signal-cycle";
export const QUEUE_UNAVAILABLE_REASON = "Redis not configured";

let queueInstance: Queue | null = null;
const redisConfig = getRedisConfiguration();
export const queueAvailable = isRedisConfigured();

export function isQueueConfigured(): boolean {
  return queueAvailable;
}

export function getQueueConfiguration() {
  return redisConfig;
}

export function createRedisConnection() {
  if (!queueAvailable) {
    throw new Error(QUEUE_UNAVAILABLE_REASON);
  }

  return createRedisConnectionOptions();
}

export function getSignalCycleQueue(): Queue {
  if (!queueAvailable) {
    throw new Error(QUEUE_UNAVAILABLE_REASON);
  }

  if (!queueInstance) {
    queueInstance = new Queue(SIGNAL_CYCLE_QUEUE, {
      connection: createRedisConnection(),
    });
  }
  return queueInstance;
}

export async function enqueueSignalCycle(
  jobId?: string,
  meta?: { actor?: string; correlationId?: string | null; retryOfRunId?: string | null }
) {
  if (!queueAvailable) {
    throw new Error(QUEUE_UNAVAILABLE_REASON);
  }

  const run = await prisma.signalRun.create({
    data: {
      queuedAt: new Date(),
      engineVersion: ENGINE_VERSION,
      featureVersion: FEATURE_VERSION,
      promptVersion: PROMPT_VERSION,
      status: "QUEUED",
    },
  });

  const jobOptions: JobsOptions = {
    jobId: jobId ?? `signal-cycle-${run.id}`,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: 100,
    removeOnFail: 100,
  };

  const job = await getSignalCycleQueue().add(
    "run",
    {
      requestedAt: new Date().toISOString(),
      runId: run.id,
      retryOfRunId: meta?.retryOfRunId ?? null,
    },
    jobOptions
  );

  await recordAuditEvent({
    actor: meta?.actor ?? "SYSTEM",
    action: "run_queued",
    entityType: "SignalRun",
    entityId: run.id,
    after: {
      queueJobId: job.id,
      retryOfRunId: meta?.retryOfRunId ?? null,
      status: "QUEUED",
    },
    correlationId: meta?.correlationId ?? run.id,
  });

  return { job, runId: run.id };
}
