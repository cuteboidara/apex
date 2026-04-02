/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logging";
import { recordAuditEvent } from "@/lib/audit";
import { ENGINE_VERSION, FAILURE_CODES, FEATURE_VERSION, PROMPT_VERSION } from "@/lib/runConfig";

const STALE_RUN_THRESHOLD_MS = 5 * 60 * 1000; // 300 000 ms — matches Railway maxDuration

type SignalRunSeed = {
  id?: string | null;
  queuedAt?: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  totalDurationMs?: number | null;
  dataFetchDurationMs?: number | null;
  scoringDurationMs?: number | null;
  persistenceDurationMs?: number | null;
  alertDispatchDurationMs?: number | null;
  status?: string;
  failureCode?: string | null;
  failureReason?: string | null;
  failureDetails?: Prisma.InputJsonValue | null;
};

function buildSignalRunCreateData(seed: SignalRunSeed = {}): Prisma.SignalRunUncheckedCreateInput {
  const failureDetails =
    seed.failureDetails === null
      ? Prisma.JsonNull
      : seed.failureDetails;

  return {
    ...(seed.id ? { id: seed.id } : {}),
    queuedAt: seed.queuedAt ?? new Date(),
    startedAt: seed.startedAt ?? null,
    completedAt: seed.completedAt ?? null,
    totalDurationMs: seed.totalDurationMs ?? null,
    dataFetchDurationMs: seed.dataFetchDurationMs ?? null,
    scoringDurationMs: seed.scoringDurationMs ?? null,
    persistenceDurationMs: seed.persistenceDurationMs ?? null,
    alertDispatchDurationMs: seed.alertDispatchDurationMs ?? null,
    engineVersion: ENGINE_VERSION,
    featureVersion: FEATURE_VERSION,
    promptVersion: PROMPT_VERSION,
    status: seed.status ?? "QUEUED",
    failureCode: seed.failureCode ?? null,
    failureReason: seed.failureReason ?? null,
    ...(failureDetails !== undefined ? { failureDetails } : {}),
  };
}

export function isSignalRunNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "P2025") return true;

  const message = error instanceof Error ? error.message : String(error);
  return message.includes("No record was found for an update");
}

export async function createSignalRunRecord(seed: SignalRunSeed = {}) {
  return prisma.signalRun.create({
    data: buildSignalRunCreateData(seed),
  });
}

export async function ensureSignalRunRecord(runId?: string | null, seed: SignalRunSeed = {}) {
  if (runId) {
    const existing = await prisma.signalRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        queuedAt: true,
        startedAt: true,
      },
    });

    if (existing) {
      return existing;
    }

    return createSignalRunRecord({
      ...seed,
      id: runId,
      status: seed.status ?? "RECOVERED",
    });
  }

  return createSignalRunRecord(seed);
}

export async function updateSignalRunWithRecovery(
  runId: string | null | undefined,
  data: Prisma.SignalRunUpdateInput,
  recoverySeed: SignalRunSeed = {}
) {
  const ensuredRunId = runId ?? (await createSignalRunRecord({
    ...recoverySeed,
    status: recoverySeed.status ?? "RECOVERED",
  })).id;

  try {
    return await prisma.signalRun.update({
      where: { id: ensuredRunId },
      data,
    });
  } catch (error) {
    if (!isSignalRunNotFoundError(error)) {
      throw error;
    }

    await createSignalRunRecord({
      ...recoverySeed,
      id: ensuredRunId,
      status: recoverySeed.status ?? "RECOVERED",
    });

    return prisma.signalRun.update({
      where: { id: ensuredRunId },
      data,
    });
  }
}

function getRunAgeMs(run: { startedAt: Date | null; queuedAt: Date }) {
  const baseline = run.startedAt ?? run.queuedAt;
  return Date.now() - baseline.getTime();
}

export async function reconcileStaleRuns() {
  const activeRuns = await prisma.signalRun.findMany({
    where: {
      status: {
        in: ["QUEUED", "RUNNING"],
      },
      completedAt: null,
    },
    select: {
      id: true,
      status: true,
      queuedAt: true,
      startedAt: true,
    },
  });

  const staleRuns = activeRuns.filter(run => getRunAgeMs(run) > STALE_RUN_THRESHOLD_MS);

  for (const run of staleRuns) {
    const baseline = run.startedAt ?? run.queuedAt;
    const totalDurationMs = Math.max(0, Date.now() - baseline.getTime());
    const failureReason = `Run reconciled after exceeding ${STALE_RUN_THRESHOLD_MS}ms without completion`;

    await prisma.signalRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        totalDurationMs,
        failureCode: FAILURE_CODES.UNKNOWN_ERROR,
        failureReason,
        failureDetails: [
          {
            failureCode: FAILURE_CODES.UNKNOWN_ERROR,
            reason: failureReason,
          },
        ],
      },
    });

    logEvent({
      runId: run.id,
      component: "run-lifecycle",
      severity: "WARN",
      message: "Stale run reconciled to FAILED",
      previousStatus: run.status,
      totalDurationMs,
    });

    await recordAuditEvent({
      actor: "SYSTEM",
      action: "run_reconciled",
      entityType: "SignalRun",
      entityId: run.id,
      before: {
        status: run.status,
        startedAt: run.startedAt?.toISOString() ?? null,
        queuedAt: run.queuedAt.toISOString(),
      },
      after: {
        status: "FAILED",
        failureCode: FAILURE_CODES.UNKNOWN_ERROR,
        totalDurationMs,
      },
      correlationId: run.id,
    });
  }

  return staleRuns.length;
}

