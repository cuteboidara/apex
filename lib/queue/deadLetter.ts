import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordOperationalMetric } from "@/lib/observability/metrics";

export type DeadLetterInput = {
  queueName: string;
  jobId: string;
  runId?: string | null;
  attemptsMade: number;
  reason: string;
  payload?: Record<string, unknown> | null;
  correlationId?: string | null;
  metadata?: Record<string, unknown> | null;
};

function toJsonValue(value: Record<string, unknown> | null | undefined) {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

export async function persistDeadLetterJob(input: DeadLetterInput): Promise<void> {
  try {
    await prisma.deadLetterJob.upsert({
      where: { jobId: input.jobId },
      create: {
        queueName: input.queueName,
        jobId: input.jobId,
        runId: input.runId ?? null,
        status: "FAILED",
        attemptsMade: input.attemptsMade,
        reason: input.reason.slice(0, 2000),
        payload: toJsonValue(input.payload),
        correlationId: input.correlationId ?? null,
        metadata: toJsonValue(input.metadata),
      },
      update: {
        status: "FAILED",
        attemptsMade: input.attemptsMade,
        reason: input.reason.slice(0, 2000),
        payload: toJsonValue(input.payload),
        correlationId: input.correlationId ?? null,
        metadata: toJsonValue(input.metadata),
        failedAt: new Date(),
      },
    });
  } catch {
    // Dead-letter persistence must not block queue failure handling.
  }

  await recordOperationalMetric({
    metric: "dead_letter_job",
    category: "queue",
    severity: "ERROR",
    count: 1,
    runId: input.runId ?? null,
    detail: input.reason.slice(0, 500),
    tags: {
      queueName: input.queueName,
      jobId: input.jobId,
      attemptsMade: input.attemptsMade,
    },
  });
}

export async function markDeadLetterReplayed(jobId: string, replayStatus: string): Promise<void> {
  try {
    await prisma.deadLetterJob.update({
      where: { jobId },
      data: {
        replayedAt: new Date(),
        replayStatus,
      },
    });
  } catch {
    // Manual replay metadata should never block operator actions.
  }
}

export async function getDeadLetterOverview(limit = 25) {
  const jobs = await prisma.deadLetterJob.findMany({
    orderBy: { failedAt: "desc" },
    take: limit,
  });

  return {
    total: jobs.length,
    jobs,
  };
}
