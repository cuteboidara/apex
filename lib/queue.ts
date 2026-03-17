import { ConnectionOptions, JobsOptions, Queue } from "bullmq";
import { prisma } from "@/lib/prisma";
import { recordAuditEvent } from "@/lib/audit";
import { ENGINE_VERSION, FEATURE_VERSION, PROMPT_VERSION } from "@/lib/runConfig";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

export const SIGNAL_CYCLE_QUEUE = "signal-cycle";

export function createRedisConnection(): ConnectionOptions {
  const url = new URL(REDIS_URL);
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

const queueConnection = createRedisConnection();

export const signalCycleQueue = new Queue(SIGNAL_CYCLE_QUEUE, {
  connection: queueConnection,
});

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

  const job = await signalCycleQueue.add(
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
