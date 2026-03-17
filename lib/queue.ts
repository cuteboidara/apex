import { ConnectionOptions, JobsOptions, Queue } from "bullmq";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit";
import { ENGINE_VERSION, FEATURE_VERSION, PROMPT_VERSION } from "@/lib/runConfig";

export const SIGNAL_CYCLE_QUEUE = "signal-cycle";

let queueInstance: Queue | null = null;

function getRedisUrl(): string {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("Redis configuration missing. Set REDIS_URL for queue-backed routes and workers.");
  }
  return redisUrl;
}

export function isQueueConfigured(): boolean {
  return Boolean(process.env.REDIS_URL);
}

export function createRedisConnection(): ConnectionOptions {
  const redisUrl = getRedisUrl();
  const url = new URL(redisUrl);
  const tls = url.protocol === "rediss:" ? {} : undefined;

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
    tls,
  };
}

export function getSignalCycleQueue(): Queue {
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
