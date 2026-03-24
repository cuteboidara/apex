import assert from "node:assert/strict";
import test from "node:test";

import { createSystemRouteHandler } from "@/app/api/system/route";
import { classifyProviderStatus } from "@/lib/providerStatusClassifier";

test("system route returns valid JSON with empty stats when the database is empty", async () => {
  const GET = createSystemRouteHandler({
    prisma: {
      providerHealth: {
        findMany: async () => [],
      },
      signalRun: {
        count: async () => 0,
        findFirst: async () => null,
      },
      signal: {
        count: async () => 0,
      },
      tradePlan: {
        count: async () => 0,
        findMany: async () => [],
      },
      alert: {
        count: async () => 0,
      },
    } as never,
    getProviderSummaries: async () => [] as never,
    recordProviderHealth: async () => undefined,
    classifyProviderStatus,
    buildLatestSetupBreakdown: () => ({
      runId: null,
      long: 0,
      short: 0,
      noSetup: 0,
      active: 0,
      stale: 0,
      total: 0,
      directionBalance: "BALANCED",
      generatedAt: null,
    }) as never,
    getQueueConfiguration: () => ({ source: "none" }) as never,
    getSignalCycleQueue: () => ({
      getJobCounts: async () => ({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
    }) as never,
    queueAvailable: false,
    queueUnavailableReason: "Queue unavailable",
    getRuntimeCacheMode: () => "memory" as never,
    getRedisConfiguration: () => ({ source: "none", restOnlyConfigured: false }) as never,
    isRedisConfigured: () => false,
  });

  const response = await GET();
  const payload = await response.json() as {
    ok: boolean;
    stats: {
      signals: number;
      runs: number;
      tradePlans: number;
      alerts: number;
      resolvedTrades: number;
      winRate: number;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.stats, {
    signals: 0,
    runs: 0,
    tradePlans: 0,
    alerts: 0,
    resolvedTrades: 0,
    winRate: 0,
  });
});

test("provider classifier keeps Yahoo available and degrades Binance on 451 region restrictions", () => {
  const yahoo = classifyProviderStatus("available", "Primary forex provider", "Yahoo Finance");
  const binance = classifyProviderStatus("error", "HTTP 451 unavailable from a restricted location", "Binance");

  assert.equal(yahoo.availability, "available");
  assert.equal(yahoo.displayStatus, "available");
  assert.equal(binance.availability, "degraded");
  assert.equal(binance.displayStatus, "degraded");
});
