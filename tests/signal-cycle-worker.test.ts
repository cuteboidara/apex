import assert from "node:assert/strict";
import test from "node:test";

import { createSignalCycleFailureHandler, createSignalCycleJobProcessor } from "@/lib/signalCycleJob";
import { createRunCycle } from "@/lib/scheduler";

test("signal cycle worker creates and completes a run when the job has no runId", async () => {
  const updates: Array<{ runId: string; status: unknown }> = [];
  const createdRuns: string[] = [];
  const runStore = new Map<string, { id: string; queuedAt: Date; startedAt: Date | null }>();

  const runCycle = createRunCycle({
    prisma: {
      signalRun: {
        findUnique: async ({ where }: { where: { id: string } }) => runStore.get(where.id) ?? null,
      },
    } as never,
    runFullCycle: async runId => ({
      runId,
      signals: [{ rank: "A" }] as never,
      metrics: {} as never,
    }),
    sendSignal: async () => undefined as never,
    recordAuditEvent: async () => undefined,
    ensureSignalRunRecord: async (runId?: string | null) => {
      const id = runId ?? `run_auto_${createdRuns.length + 1}`;
      const run = {
        id,
        queuedAt: new Date("2026-03-24T00:00:00Z"),
        startedAt: null,
      };
      createdRuns.push(id);
      runStore.set(id, run);
      return run as never;
    },
    updateSignalRunWithRecovery: async (runId, data) => {
      updates.push({ runId: String(runId), status: (data as { status?: unknown }).status });
      return { id: runId } as never;
    },
  });

  const processJob = createSignalCycleJobProcessor({ runCycle });
  const result = await processJob({ data: {} });

  assert.equal(result.runId, "run_auto_1");
  assert.equal(result.count, 1);
  assert.deepEqual(createdRuns, ["run_auto_1"]);
  assert.ok(updates.some(update => update.runId === "run_auto_1" && update.status === "COMPLETED"));
});

test("signal cycle worker recovers a stale runId and completes without duplicate run creation", async () => {
  const updates: Array<{ runId: string; status: unknown }> = [];
  const ensuredRunIds: string[] = [];
  const runStore = new Map<string, { id: string; queuedAt: Date; startedAt: Date | null }>();

  const runCycle = createRunCycle({
    prisma: {
      signalRun: {
        findUnique: async ({ where }: { where: { id: string } }) => runStore.get(where.id) ?? null,
      },
    } as never,
    runFullCycle: async runId => ({
      runId,
      signals: [{ rank: "S" }] as never,
      metrics: {} as never,
    }),
    sendSignal: async () => undefined as never,
    recordAuditEvent: async () => undefined,
    ensureSignalRunRecord: async (runId?: string | null) => {
      const id = runId ?? "unexpected";
      ensuredRunIds.push(id);
      const recovered = {
        id,
        queuedAt: new Date("2026-03-24T00:05:00Z"),
        startedAt: new Date("2026-03-24T00:06:00Z"),
      };
      runStore.set(id, recovered);
      return recovered as never;
    },
    updateSignalRunWithRecovery: async (runId, data) => {
      updates.push({ runId: String(runId), status: (data as { status?: unknown }).status });
      return { id: runId } as never;
    },
  });

  const processJob = createSignalCycleJobProcessor({ runCycle });
  const result = await processJob({ data: { runId: "run_stale_1" } });

  assert.equal(result.runId, "run_stale_1");
  assert.equal(result.count, 1);
  assert.deepEqual(ensuredRunIds, ["run_stale_1"]);
  assert.ok(updates.some(update => update.runId === "run_stale_1" && update.status === "COMPLETED"));
});

test("signal cycle worker failure handler persists failed state for stale runs without crashing", async () => {
  const updates: Array<{ runId: string; status: unknown; failureCode?: unknown }> = [];
  const audits: string[] = [];

  const persistFailure = createSignalCycleFailureHandler({
    ensureSignalRunRecord: async (runId?: string | null) => ({
      id: runId ?? "run_fail_1",
      queuedAt: new Date("2026-03-24T00:10:00Z"),
      startedAt: new Date("2026-03-24T00:11:00Z"),
    }) as never,
    updateSignalRunWithRecovery: async (runId, data) => {
      updates.push({
        runId: String(runId),
        status: (data as { status?: unknown }).status,
        failureCode: (data as { failureCode?: unknown }).failureCode,
      });
      return { id: runId } as never;
    },
    recordAuditEvent: async input => {
      audits.push(input.action);
    },
  });

  const recoveredRunId = await persistFailure({
    runId: "run_fail_1",
    correlationId: "run_fail_1",
    error: new Error("run execution exploded"),
  });

  assert.equal(recoveredRunId, "run_fail_1");
  assert.ok(updates.some(update => update.runId === "run_fail_1" && update.status === "FAILED"));
  assert.ok(updates.some(update => update.failureCode === "UNKNOWN_ERROR"));
  assert.ok(audits.includes("run_failed"));
});
