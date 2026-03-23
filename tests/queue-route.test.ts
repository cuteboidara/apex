import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

import { createQueueRouteHandlers } from "@/app/api/queue/route";

test("queue route mutating actions require admin auth", async () => {
  const route = createQueueRouteHandlers({
    prisma: {} as never,
    getSignalCycleQueue: (() => {
      throw new Error("should not be called");
    }) as never,
    enqueueSignalCycle: (async () => {
      throw new Error("should not be called");
    }) as never,
    getDeadLetterOverview: async () => ({ total: 0, jobs: [] }),
    markDeadLetterReplayed: async () => undefined,
    recordAuditEvent: async () => undefined,
    requeueAlerts: async () => 0,
    setAlertSendingPaused: async () => undefined,
    reconcileStaleRuns: async () => undefined,
    requireAdmin: async () => ({
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }),
    queueAvailable: true,
    queueUnavailableReason: "missing",
  });

  const response = await route.POST(new Request("http://localhost/api/queue", {
    method: "POST",
    body: JSON.stringify({ action: "enqueue_cycle" }),
    headers: { "Content-Type": "application/json" },
  }) as never);

  assert.equal(response.status, 403);
});

test("queue retry_job replays dead-letter metadata and records audit history", async () => {
  const audited: string[] = [];
  let replayed = false;
  const route = createQueueRouteHandlers({
    prisma: {} as never,
    getSignalCycleQueue: () => ({
      getJob: async () => ({
        retry: async () => undefined,
      }),
    }) as never,
    enqueueSignalCycle: (async () => ({
      job: { id: "job_1" },
      runId: "run_1",
    })) as never,
    getDeadLetterOverview: async () => ({ total: 0, jobs: [] }),
    markDeadLetterReplayed: async () => {
      replayed = true;
    },
    recordAuditEvent: async input => {
      audited.push(input.action);
    },
    requeueAlerts: async () => 0,
    setAlertSendingPaused: async () => undefined,
    reconcileStaleRuns: async () => undefined,
    requireAdmin: async () => ({ ok: true as const }),
    queueAvailable: true,
    queueUnavailableReason: "missing",
  });

  const response = await route.POST(new Request("http://localhost/api/queue", {
    method: "POST",
    body: JSON.stringify({ action: "retry_job", jobId: "job_9", runId: "run_9" }),
    headers: { "Content-Type": "application/json" },
  }) as never);
  const payload = await response.json() as { action: string };

  assert.equal(response.status, 200);
  assert.equal(payload.action, "retry_job");
  assert.equal(replayed, true);
  assert.deepEqual(audited, ["manual_retry_job"]);
});
