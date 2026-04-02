import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { NextResponse } from "next/server";

import { createAdminDailyRunsRouteHandler } from "@/app/api/admin/daily-runs/route";
import { createAdminDailyRunDetailRouteHandler } from "@/app/api/admin/daily-runs/[id]/route";
import { createRetryDailySignalDeliveryRouteHandler } from "@/app/api/admin/daily-runs/[id]/retry-delivery/route";
import { createDailySignalsJobRouteHandler } from "@/app/api/jobs/daily-signals/route";
import { publishDailySignals } from "@/src/application/signals/publishDailySignals";
import { retryDailySignalDelivery } from "@/src/application/signals/retryDailySignalDelivery";
import { runDailySignals } from "@/src/application/signals/runDailySignals";
import type {
  DailySignalDeliveryRecord,
} from "@/src/infrastructure/persistence/dailySignalDeliveryRepository";
import type {
  DailySignalRunRecord,
} from "@/src/infrastructure/persistence/dailySignalRunRepository";

function makeRunRecord(overrides: Partial<DailySignalRunRecord> = {}): DailySignalRunRecord {
  return {
    id: "run_1",
    windowKey: "2026-03-27:london:UTC",
    baseWindowKey: "2026-03-27:london:UTC",
    runDate: "2026-03-27",
    timezone: "UTC",
    scheduledTime: "08:00",
    triggeredBy: "manual_secret",
    triggerSource: "manual_secret",
    status: "running",
    forced: false,
    dryRun: false,
    zeroSignalDay: false,
    generatedCount: 0,
    publishedCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    signalPayload: null,
    errorMessage: null,
    createdAt: new Date("2026-03-27T08:00:00.000Z"),
    updatedAt: new Date("2026-03-27T08:00:00.000Z"),
    completedAt: null,
    ...overrides,
  };
}

function makeDeliveryRecord(overrides: Partial<DailySignalDeliveryRecord> = {}): DailySignalDeliveryRecord {
  return {
    id: "delivery_1",
    runId: "run_1",
    channel: "telegram",
    target: "chat:123",
    dedupeKey: "dedupe_1",
    payloadHash: "hash_1",
    status: "queued",
    attempts: 0,
    explicitRetry: false,
    providerMessageId: null,
    errorMessage: null,
    payloadSnapshot: {
      publishableSignals: [],
    },
    createdAt: new Date("2026-03-27T08:00:05.000Z"),
    updatedAt: new Date("2026-03-27T08:00:05.000Z"),
    lastAttemptAt: null,
    deliveredAt: null,
    ...overrides,
  };
}

class FakeRunRepository {
  readonly items = new Map<string, DailySignalRunRecord>();

  async findLatestByBaseWindowKey(baseWindowKey: string) {
    return [...this.items.values()]
      .filter(item => item.baseWindowKey === baseWindowKey)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ?? null;
  }

  async findById(id: string) {
    return this.items.get(id) ?? null;
  }

  async create(input: Omit<DailySignalRunRecord, "id" | "createdAt" | "updatedAt"> & { completedAt?: Date | null }) {
    const existing = [...this.items.values()].find(item => item.windowKey === input.windowKey) ?? null;
    if (existing) {
      return { record: existing, created: false };
    }

    const record = makeRunRecord({
      ...input,
      id: `run_${this.items.size + 1}`,
      createdAt: new Date("2026-03-27T08:00:00.000Z"),
      updatedAt: new Date("2026-03-27T08:00:00.000Z"),
    });
    this.items.set(record.id, record);
    return { record, created: true };
  }

  async update(id: string, patch: Partial<DailySignalRunRecord>) {
    const current = this.items.get(id);
    if (!current) {
      throw new Error(`Run ${id} not found`);
    }

    const updated = {
      ...current,
      ...patch,
      updatedAt: new Date("2026-03-27T08:05:00.000Z"),
    };
    this.items.set(id, updated);
    return updated;
  }

  async listRecent(limit = 20) {
    return [...this.items.values()]
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, limit);
  }
}

class FakeDeliveryRepository {
  readonly items = new Map<string, DailySignalDeliveryRecord>();

  async findById(id: string) {
    return this.items.get(id) ?? null;
  }

  async findByDedupeKey(dedupeKey: string) {
    return [...this.items.values()].find(item => item.dedupeKey === dedupeKey) ?? null;
  }

  async create(input: Omit<DailySignalDeliveryRecord, "id" | "createdAt" | "updatedAt"> & {
    lastAttemptAt?: Date | null;
    deliveredAt?: Date | null;
  }) {
    const existing = [...this.items.values()].find(item => item.dedupeKey === input.dedupeKey) ?? null;
    if (existing) {
      return { record: existing, created: false };
    }

    const record = makeDeliveryRecord({
      ...input,
      id: `delivery_${this.items.size + 1}`,
      createdAt: new Date("2026-03-27T08:00:05.000Z"),
      updatedAt: new Date("2026-03-27T08:00:05.000Z"),
    });
    this.items.set(record.id, record);
    return { record, created: true };
  }

  async update(id: string, patch: Partial<DailySignalDeliveryRecord>) {
    const current = this.items.get(id);
    if (!current) {
      throw new Error(`Delivery ${id} not found`);
    }

    const updated = {
      ...current,
      ...patch,
      updatedAt: new Date("2026-03-27T08:06:00.000Z"),
    };
    this.items.set(id, updated);
    return updated;
  }

  async listByRunId(runId: string) {
    return [...this.items.values()]
      .filter(item => item.runId === runId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }
}

function makeSignalsPayload() {
  return {
    generatedAt: 1_774_569_600_000,
    cards: [
      {
        symbol: "EURUSD",
        status: "active",
        grade: "A",
        shortReasoning: "Bullish continuation remains intact.",
      },
      {
        symbol: "GBPUSD",
        status: "watchlist",
        grade: "C",
        shortReasoning: "Watching for structure confirmation.",
      },
    ],
    marketCommentary: {
      overallContext: "Momentum is mixed.",
      sessionNote: "London open is driving the tape.",
      topOpportunity: "EURUSD",
      riskNote: "Stay selective.",
    },
  };
}

function makeDailyConfig() {
  return {
    enabled: true,
    time: "08:00",
    sessionTimes: {
      asia: "00:00",
      london: "08:00",
      new_york: "13:00",
    },
    timezone: "UTC",
    minimumGrade: "B" as const,
    telegramEnabled: true,
    sendZeroSignalSummary: true,
  };
}

describe("Daily Signal Subsystem", () => {
  describe("runDailySignals", () => {
    test("creates a DailySignalRun record with the expected windowKey and completes it", async () => {
      const runRepository = new FakeRunRepository();
      const result = await runDailySignals(
        {
          now: new Date("2026-03-27T08:00:00.000Z"),
          triggerSource: "manual_secret",
          triggeredBy: "manual_secret",
        },
        {
          runRepository: runRepository as never,
          getConfig: async () => makeDailyConfig(),
          getSignals: async () => makeSignalsPayload() as never,
          publish: async runId => ({
            run: (await runRepository.findById(runId))!,
            deliveries: [],
            deliveredCount: 0,
            failedCount: 0,
          }),
        },
      );

      assert.equal(result.created, true);
      assert.equal(result.run.windowKey, "2026-03-27:london:UTC");
      assert.equal(result.run.status, "completed");
      assert.equal(result.run.generatedCount, 2);
      assert.equal(result.zeroSignalDay, false);
    });

    test("returns an existing run when the same base window already exists and force=false", async () => {
      const runRepository = new FakeRunRepository();
      const existing = makeRunRecord({
        id: "existing_run",
        status: "completed",
        generatedCount: 2,
      });
      runRepository.items.set(existing.id, existing);

      let signalsCalled = false;
      const result = await runDailySignals(
        {
          now: new Date("2026-03-27T08:00:00.000Z"),
          triggerSource: "manual_secret",
          triggeredBy: "manual_secret",
        },
        {
          runRepository: runRepository as never,
          getConfig: async () => makeDailyConfig(),
          getSignals: async () => {
            signalsCalled = true;
            return makeSignalsPayload() as never;
          },
        },
      );

      assert.equal(result.created, false);
      assert.equal(result.run.id, "existing_run");
      assert.equal(signalsCalled, false);
    });

    test("creates a new forced run when a same-window run exists and force=true", async () => {
      const runRepository = new FakeRunRepository();
      runRepository.items.set("existing_run", makeRunRecord({ id: "existing_run", status: "completed" }));

      const result = await runDailySignals(
        {
          force: true,
          now: new Date("2026-03-27T08:00:00.000Z"),
          triggerSource: "operator",
          triggeredBy: "operator@example.com",
        },
        {
          runRepository: runRepository as never,
          getConfig: async () => makeDailyConfig(),
          getSignals: async () => makeSignalsPayload() as never,
          publish: async runId => ({
            run: (await runRepository.findById(runId))!,
            deliveries: [],
            deliveredCount: 0,
            failedCount: 0,
          }),
        },
      );

      assert.equal(result.created, true);
      assert.equal(result.run.forced, true);
      assert.match(result.run.windowKey, /^2026-03-27:london:UTC:force:/);
    });

    test("sets status to failed if signal fetch throws", async () => {
      const runRepository = new FakeRunRepository();

      await assert.rejects(
        () => runDailySignals(
          {
            now: new Date("2026-03-27T08:00:00.000Z"),
            triggerSource: "manual_secret",
            triggeredBy: "manual_secret",
          },
          {
            runRepository: runRepository as never,
            getConfig: async () => makeDailyConfig(),
            getSignals: async () => {
              throw new Error("signal_fetch_failed");
            },
          },
        ),
        /signal_fetch_failed/,
      );

      const stored = [...runRepository.items.values()][0];
      assert.equal(stored?.status, "failed");
      assert.match(stored?.errorMessage ?? "", /signal_fetch_failed/);
    });

    test("creates distinct runs for separate market sessions on the same date", async () => {
      const runRepository = new FakeRunRepository();

      const asia = await runDailySignals(
        {
          now: new Date("2026-03-27T00:00:00.000Z"),
          session: "asia",
          triggerSource: "manual_secret",
          triggeredBy: "manual_secret",
        },
        {
          runRepository: runRepository as never,
          getConfig: async () => makeDailyConfig(),
          getSignals: async () => makeSignalsPayload() as never,
          publish: async runId => ({
            run: (await runRepository.findById(runId))!,
            deliveries: [],
            deliveredCount: 0,
            failedCount: 0,
          }),
        },
      );

      const london = await runDailySignals(
        {
          now: new Date("2026-03-27T08:00:00.000Z"),
          session: "london",
          triggerSource: "manual_secret",
          triggeredBy: "manual_secret",
        },
        {
          runRepository: runRepository as never,
          getConfig: async () => makeDailyConfig(),
          getSignals: async () => makeSignalsPayload() as never,
          publish: async runId => ({
            run: (await runRepository.findById(runId))!,
            deliveries: [],
            deliveredCount: 0,
            failedCount: 0,
          }),
        },
      );

      assert.equal(asia.run.baseWindowKey, "2026-03-27:asia:UTC");
      assert.equal(london.run.baseWindowKey, "2026-03-27:london:UTC");
      assert.notEqual(asia.run.id, london.run.id);
    });
  });

  describe("publishDailySignals", () => {
    test("skips delivery if dryRun=true", async () => {
      const runRepository = new FakeRunRepository();
      const deliveryRepository = new FakeDeliveryRepository();
      const run = makeRunRecord({
        id: "run_dry",
        dryRun: true,
        status: "completed",
        signalPayload: {
          generatedAt: 1,
          minimumGrade: "B",
          allCardsCount: 1,
          publishableCardsCount: 1,
          cards: [{ symbol: "EURUSD", grade: "A", status: "active" }] as never,
          marketCommentary: null,
        },
      });
      runRepository.items.set(run.id, run);

      let channelCalls = 0;
      const result = await publishDailySignals(run.id, {
        runRepository: runRepository as never,
        deliveryRepository: deliveryRepository as never,
        getConfig: async () => makeDailyConfig(),
        channels: [{
          channelId: "telegram",
          isEnabled: () => true,
          getTarget: () => "chat:123",
          send: async input => {
            channelCalls += 1;
            assert.equal(input.dryRun, true);
            return { status: "skipped", target: "chat:123", detail: "dry_run" };
          },
        }],
      });

      assert.equal(channelCalls, 1);
      assert.equal(result.deliveries[0]?.status, "skipped");
    });

    test("resolves to an existing delivery record on duplicate dedupeKey", async () => {
      const runRepository = new FakeRunRepository();
      const deliveryRepository = new FakeDeliveryRepository();
      const run = makeRunRecord({
        id: "run_dup",
        status: "completed",
        signalPayload: {
          generatedAt: 1,
          minimumGrade: "B",
          allCardsCount: 1,
          publishableCardsCount: 1,
          cards: [{ symbol: "EURUSD", grade: "A", status: "active" }] as never,
          marketCommentary: null,
        },
      });
      runRepository.items.set(run.id, run);

      let channelCalls = 0;
      const channel = {
        channelId: "telegram",
        isEnabled: () => true,
        getTarget: () => "chat:123",
        send: async () => {
          channelCalls += 1;
          return { status: "delivered" as const, target: "chat:123", providerMessageId: "msg_1" };
        },
      };

      const first = await publishDailySignals(run.id, {
        runRepository: runRepository as never,
        deliveryRepository: deliveryRepository as never,
        getConfig: async () => makeDailyConfig(),
        channels: [channel],
      });
      const second = await publishDailySignals(run.id, {
        runRepository: runRepository as never,
        deliveryRepository: deliveryRepository as never,
        getConfig: async () => makeDailyConfig(),
        channels: [channel],
      });

      assert.equal(first.deliveries.length, 1);
      assert.equal(second.deliveries.length, 1);
      assert.equal(channelCalls, 1);
      assert.equal(second.deliveries[0]?.id, first.deliveries[0]?.id);
    });

    test("sets delivery status to failed if the notification channel throws", async () => {
      const runRepository = new FakeRunRepository();
      const deliveryRepository = new FakeDeliveryRepository();
      const run = makeRunRecord({
        id: "run_fail",
        status: "completed",
        signalPayload: {
          generatedAt: 1,
          minimumGrade: "B",
          allCardsCount: 1,
          publishableCardsCount: 1,
          cards: [{ symbol: "EURUSD", grade: "A", status: "active" }] as never,
          marketCommentary: null,
        },
      });
      runRepository.items.set(run.id, run);

      const result = await publishDailySignals(run.id, {
        runRepository: runRepository as never,
        deliveryRepository: deliveryRepository as never,
        getConfig: async () => makeDailyConfig(),
        channels: [{
          channelId: "telegram",
          isEnabled: () => true,
          getTarget: () => "chat:123",
          send: async () => {
            throw new Error("telegram_down");
          },
        }],
      });

      assert.equal(result.failedCount, 1);
      assert.equal(result.deliveries[0]?.status, "failed");
      assert.match(result.deliveries[0]?.errorMessage ?? "", /telegram_down/);
    });
  });

  describe("daily-signals job route", () => {
    test("returns 401 if admin secret is missing and no operator session exists", async () => {
      const handler = createDailySignalsJobRouteHandler({
        getConfiguredAdminSecret: () => "secret",
        requireOperator: async () => ({
          ok: false as const,
          response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        }),
      });

      const response = await handler(new Request("http://localhost/api/jobs/daily-signals", {
        method: "POST",
        body: JSON.stringify({}),
      }) as never);

      assert.equal(response.status, 401);
    });

    test("returns 401 if admin secret is wrong", async () => {
      const handler = createDailySignalsJobRouteHandler({
        getConfiguredAdminSecret: () => "secret",
      });

      const response = await handler(new Request("http://localhost/api/jobs/daily-signals", {
        method: "POST",
        headers: { "x-apex-admin-secret": "wrong" },
        body: JSON.stringify({}),
      }) as never);

      assert.equal(response.status, 401);
    });

    test("manual secret bypasses the schedule window and still runs", async () => {
      let runCalled = false;
      const handler = createDailySignalsJobRouteHandler({
        getConfiguredAdminSecret: () => "secret",
        getConfig: async () => makeDailyConfig(),
        shouldRunNowFn: () => false,
        runDailySignalsFn: async () => {
          runCalled = true;
          return {
            run: makeRunRecord({
              id: "run_manual",
              status: "completed",
              generatedCount: 2,
            }),
            created: true,
            zeroSignalDay: false,
            deliveries: [],
            deliveredCount: 0,
            failedCount: 0,
          };
        },
      });

      const response = await handler(new Request("http://localhost/api/jobs/daily-signals", {
        method: "POST",
        headers: { "x-apex-admin-secret": "secret" },
        body: JSON.stringify({}),
      }) as never);
      const payload = await response.json() as {
        executed: boolean;
        reason: string;
        triggerSource?: string;
        runId?: string;
      };

      assert.equal(response.status, 200);
      assert.equal(payload.executed, true);
      assert.equal(payload.reason, "scheduled_run_created");
      assert.equal(payload.triggerSource, "manual_secret");
      assert.equal(payload.runId, "run_manual");
      assert.equal(runCalled, true);
    });

    test("returns structured job response with runId and signalCount", async () => {
      const handler = createDailySignalsJobRouteHandler({
        getConfiguredAdminSecret: () => "secret",
        getConfig: async () => makeDailyConfig(),
        shouldRunNowFn: () => true,
        runDailySignalsFn: async () => ({
          run: makeRunRecord({
            id: "run_job",
            status: "completed",
            generatedCount: 3,
          }),
          created: true,
          zeroSignalDay: false,
          deliveries: [],
          deliveredCount: 1,
          failedCount: 0,
        }),
      });

      const response = await handler(new Request("http://localhost/api/jobs/daily-signals", {
        method: "POST",
        headers: { "x-apex-admin-secret": "secret" },
        body: JSON.stringify({ dryRun: false }),
      }) as never);
      const payload = await response.json() as { success: boolean; runId: string; generatedCount: number };

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.runId, "run_job");
      assert.equal(payload.generatedCount, 3);
    });
  });

  describe("admin daily-runs API", () => {
    const allowAccess = async () => ({ ok: true as const, actor: "admin@example.com" });
    const denyAccess = async () => ({
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    test("GET /api/admin/daily-runs returns list of runs ordered by createdAt desc", async () => {
      const runRepository = new FakeRunRepository();
      const deliveryRepository = new FakeDeliveryRepository();
      runRepository.items.set("run_old", makeRunRecord({
        id: "run_old",
        createdAt: new Date("2026-03-26T08:00:00.000Z"),
      }));
      runRepository.items.set("run_new", makeRunRecord({
        id: "run_new",
        createdAt: new Date("2026-03-27T08:00:00.000Z"),
      }));

      const handler = createAdminDailyRunsRouteHandler({
        requireAccess: allowAccess,
        createRunRepository: () => runRepository as never,
        createDeliveryRepository: () => deliveryRepository as never,
      });

      const response = await handler(new Request("http://localhost/api/admin/daily-runs?limit=10") as never);
      const payload = await response.json() as { runs: AdminDailyRunViewLike[] };

      assert.equal(response.status, 200);
      assert.equal(payload.runs[0]?.id, "run_new");
      assert.equal(payload.runs[1]?.id, "run_old");
    });

    test("GET /api/admin/daily-runs/[id] returns a single run with deliveries", async () => {
      const runRepository = new FakeRunRepository();
      const deliveryRepository = new FakeDeliveryRepository();
      runRepository.items.set("run_1", makeRunRecord({ id: "run_1" }));
      deliveryRepository.items.set("delivery_1", makeDeliveryRecord({ id: "delivery_1", runId: "run_1" }));

      const handler = createAdminDailyRunDetailRouteHandler({
        requireAccess: allowAccess,
        createRunRepository: () => runRepository as never,
        createDeliveryRepository: () => deliveryRepository as never,
      });

      const response = await handler(new Request("http://localhost/api/admin/daily-runs/run_1") as never, {
        params: Promise.resolve({ id: "run_1" }),
      });
      const payload = await response.json() as { run: AdminDailyRunViewLike };

      assert.equal(response.status, 200);
      assert.equal(payload.run.id, "run_1");
      assert.equal(payload.run.deliveries.length, 1);
    });

    test("POST /api/admin/daily-runs/[id]/retry-delivery calls retryDailySignalDelivery", async () => {
      const runRepository = new FakeRunRepository();
      const deliveryRepository = new FakeDeliveryRepository();
      runRepository.items.set("run_1", makeRunRecord({ id: "run_1" }));
      deliveryRepository.items.set("delivery_1", makeDeliveryRecord({ id: "delivery_1", runId: "run_1", status: "failed" }));

      let retryCalled = false;
      const handler = createRetryDailySignalDeliveryRouteHandler({
        requireAccess: allowAccess,
        createRunRepository: () => runRepository as never,
        createDeliveryRepository: () => deliveryRepository as never,
        retryDelivery: async () => {
          retryCalled = true;
          return deliveryRepository.update("delivery_1", {
            status: "delivered",
            attempts: 1,
            explicitRetry: true,
            deliveredAt: new Date("2026-03-27T08:10:00.000Z"),
          });
        },
      });

      const response = await handler(new Request("http://localhost/api/admin/daily-runs/run_1/retry-delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliveryId: "delivery_1" }),
      }) as never, {
        params: Promise.resolve({ id: "run_1" }),
      });
      const payload = await response.json() as { success: boolean; delivery: { status: string } };

      assert.equal(response.status, 200);
      assert.equal(payload.success, true);
      assert.equal(payload.delivery.status, "delivered");
      assert.equal(retryCalled, true);
    });

    test("returns 404 for an unknown run id", async () => {
      const handler = createAdminDailyRunDetailRouteHandler({
        requireAccess: allowAccess,
        createRunRepository: () => new FakeRunRepository() as never,
        createDeliveryRepository: () => new FakeDeliveryRepository() as never,
      });

      const response = await handler(new Request("http://localhost/api/admin/daily-runs/missing") as never, {
        params: Promise.resolve({ id: "missing" }),
      });

      assert.equal(response.status, 404);
    });

    test("requires admin or operator access", async () => {
      const handler = createAdminDailyRunsRouteHandler({
        requireAccess: denyAccess,
        createRunRepository: () => new FakeRunRepository() as never,
        createDeliveryRepository: () => new FakeDeliveryRepository() as never,
      });

      const response = await handler(new Request("http://localhost/api/admin/daily-runs") as never);
      assert.equal(response.status, 401);
    });
  });

  describe("retryDailySignalDelivery", () => {
    test("marks a failed delivery as delivered on explicit retry", async () => {
      const runRepository = new FakeRunRepository();
      const deliveryRepository = new FakeDeliveryRepository();
      runRepository.items.set("run_1", makeRunRecord({
        id: "run_1",
        status: "completed",
        signalPayload: {
          generatedAt: 1,
          minimumGrade: "B",
          allCardsCount: 1,
          publishableCardsCount: 1,
          cards: [{ symbol: "EURUSD", grade: "A", status: "active" }] as never,
          marketCommentary: null,
        },
      }));
      deliveryRepository.items.set("delivery_1", makeDeliveryRecord({
        id: "delivery_1",
        runId: "run_1",
        status: "failed",
      }));

      const updated = await retryDailySignalDelivery("delivery_1", {
        runRepository: runRepository as never,
        deliveryRepository: deliveryRepository as never,
        channels: [{
          channelId: "telegram",
          isEnabled: () => true,
          getTarget: () => "chat:123",
          send: async input => {
            assert.equal(input.explicitRetry, true);
            return { status: "delivered", target: "chat:123", providerMessageId: "msg_retry" };
          },
        }],
      });

      assert.equal(updated.status, "delivered");
      assert.equal(updated.explicitRetry, true);
      assert.equal(updated.attempts, 1);
    });
  });
});

type AdminDailyRunViewLike = {
  id: string;
  deliveries: Array<{ id: string }>;
};
