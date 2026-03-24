import { runCycle } from "@/lib/scheduler";
import { recordAuditEvent } from "@/lib/audit";
import { FAILURE_CODES } from "@/lib/runConfig";
import { ensureSignalRunRecord, updateSignalRunWithRecovery } from "@/lib/runLifecycle";

type SignalCycleJobProcessorDependencies = {
  runCycle: typeof runCycle;
};

type SignalCycleJob = {
  data?: {
    runId?: unknown;
    requestedAt?: unknown;
    correlationId?: unknown;
    retryOfRunId?: unknown;
  };
};

export function createSignalCycleJobProcessor(deps: SignalCycleJobProcessorDependencies) {
  return async (job: SignalCycleJob) => {
    const requestedRunId = typeof job.data?.runId === "string" && job.data.runId.trim().length > 0
      ? job.data.runId
      : null;
    const { runId, signals } = await deps.runCycle(requestedRunId);
    return { runId, count: signals.length };
  };
}

type SignalCycleFailureHandlerDependencies = {
  ensureSignalRunRecord: typeof ensureSignalRunRecord;
  updateSignalRunWithRecovery: typeof updateSignalRunWithRecovery;
  recordAuditEvent: typeof recordAuditEvent;
};

export function createSignalCycleFailureHandler(deps: SignalCycleFailureHandlerDependencies) {
  return async (input: {
    runId?: string | null;
    correlationId?: string | null;
    error: unknown;
  }) => {
    const ensuredRun = await deps.ensureSignalRunRecord(input.runId, {
      id: input.runId,
      status: "RECOVERED",
      queuedAt: new Date(),
    });

    await deps.updateSignalRunWithRecovery(ensuredRun.id, {
      status: "FAILED",
      completedAt: new Date(),
      failureCode: FAILURE_CODES.UNKNOWN_ERROR,
      failureReason: String(input.error).slice(0, 1000),
    }, {
      id: ensuredRun.id,
      queuedAt: ensuredRun.queuedAt,
      startedAt: ensuredRun.startedAt,
      status: "FAILED",
    });

    await deps.recordAuditEvent({
      actor: "SYSTEM",
      action: "run_failed",
      entityType: "SignalRun",
      entityId: ensuredRun.id,
      after: {
        status: "FAILED",
        failureCode: FAILURE_CODES.UNKNOWN_ERROR,
      },
      correlationId: input.correlationId ?? ensuredRun.id,
    });

    return ensuredRun.id;
  };
}
