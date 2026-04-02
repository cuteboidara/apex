import { Queue, Worker, type Job } from "bullmq";

import { createRedisConnectionOptions, isRedisConfigured } from "@/src/lib/redis";

export const APEX_CYCLE_QUEUE = "apex-cycle";

const globalForQueue = globalThis as typeof globalThis & {
  __apexCycleQueue?: Queue | null;
  __apexCycleWorker?: Worker | null;
};

export function isApexQueueAvailable(): boolean {
  return isRedisConfigured();
}

export function getApexCycleQueue(): Queue | null {
  if (!isApexQueueAvailable()) {
    return null;
  }

  if (!globalForQueue.__apexCycleQueue) {
    globalForQueue.__apexCycleQueue = new Queue(APEX_CYCLE_QUEUE, {
      connection: createRedisConnectionOptions(),
    });
  }

  return globalForQueue.__apexCycleQueue;
}

export async function enqueueApexCycle(payload: { source: string; requestedAt: number }) {
  const queue = getApexCycleQueue();
  if (!queue) {
    return null;
  }

  return queue.add(
    "cycle",
    payload,
    {
      removeOnComplete: 100,
      removeOnFail: 100,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2_000,
      },
    },
  );
}

export function startApexCycleWorker(handler: (job: Job) => Promise<void>): Worker | null {
  if (!isApexQueueAvailable()) {
    return null;
  }

  if (globalForQueue.__apexCycleWorker && !globalForQueue.__apexCycleWorker.isRunning()) {
    globalForQueue.__apexCycleWorker = null;
  }

  if (!globalForQueue.__apexCycleWorker) {
    globalForQueue.__apexCycleWorker = new Worker(
      APEX_CYCLE_QUEUE,
      handler,
      {
        connection: createRedisConnectionOptions(),
        concurrency: 1,
      },
    );
  }

  return globalForQueue.__apexCycleWorker;
}

export function resetApexCycleWorker(): void {
  globalForQueue.__apexCycleWorker = null;
}
