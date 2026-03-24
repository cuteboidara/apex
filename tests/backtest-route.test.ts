import assert from "node:assert/strict";
import test from "node:test";

import { createBacktestRouteHandlers } from "@/app/api/backtest/route";

function createDependencies(overrides: Partial<Parameters<typeof createBacktestRouteHandlers>[0]> = {}) {
  return {
    getSession: async () => ({ user: { id: "user_1" } }) as never,
    prisma: {
      backtestRun: {
        findMany: async () => [],
        create: async () => ({ id: "run_1" }),
        update: async () => undefined,
      },
      backtestTrade: {
        createMany: async () => ({ count: 0 }),
      },
    } as never,
    runReplayBacktest: () => ({
      report: { sampleSize: 0, winRate: null, expectancy: null, maxDrawdown: null },
      trades: [],
    }) as never,
    backfillHistoricalMarketData: async () => null as never,
    getReplayPreparationRange: () => ({
      start: new Date("2026-03-01T00:00:00Z"),
      end: new Date("2026-03-02T00:00:00Z"),
    }),
    loadReplayCandlesFromStore: async () => ({
      missingTimeframes: [],
      coverage: [{ timeframe: "15m", provider: "Replay", candleCount: 40, latestTimestamp: Date.now(), reason: null }],
      selectedProvider: "Replay",
      candlesByTimeframe: {
        "15m": [{ timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: null }],
      },
    }) as never,
    recordOperationalMetric: async () => undefined,
    ...overrides,
  };
}

test("backtest route returns structured migration errors when runs cannot be loaded", async () => {
  const route = createBacktestRouteHandlers(createDependencies({
    prisma: {
      backtestRun: {
        findMany: async () => {
          const error = new Error("relation \"BacktestRun\" does not exist") as Error & { code?: string };
          error.code = "P2021";
          throw error;
        },
      },
    } as never,
  }));

  const response = await route.GET();
  const payload = await response.json() as {
    code: string;
    likelyMigrationIssue: boolean;
    message: string;
    hint: string | null;
  };

  assert.equal(response.status, 503);
  assert.equal(payload.code, "MIGRATION_REQUIRED");
  assert.equal(payload.likelyMigrationIssue, true);
  assert.match(payload.message, /backtest runs/i);
  assert.match(payload.hint ?? "", /migrate:deploy/i);
});

test("backtest route returns JSON for invalid request bodies", async () => {
  const route = createBacktestRouteHandlers(createDependencies());

  const response = await route.POST(new Request("http://localhost/api/backtest", {
    method: "POST",
    body: "{",
    headers: { "Content-Type": "application/json" },
  }) as never);
  const payload = await response.json() as {
    code: string;
    message: string;
    likelyMigrationIssue: boolean;
  };

  assert.equal(response.status, 400);
  assert.equal(payload.code, "BAD_REQUEST");
  assert.equal(payload.likelyMigrationIssue, false);
  assert.match(payload.message, /invalid backtest request body/i);
});

test("backtest route returns structured migration errors when run creation fails", async () => {
  const route = createBacktestRouteHandlers(createDependencies({
    prisma: {
      backtestRun: {
        findMany: async () => [],
        create: async () => {
          const error = new Error("The table `BacktestRun` does not exist in the current database.") as Error & { code?: string };
          error.code = "P2021";
          throw error;
        },
        update: async () => undefined,
      },
      backtestTrade: {
        createMany: async () => ({ count: 0 }),
      },
    } as never,
  }));

  const response = await route.POST(new Request("http://localhost/api/backtest", {
    method: "POST",
    body: JSON.stringify({
      symbol: "EURUSD",
      assetClass: "FOREX",
      style: "INTRADAY",
    }),
    headers: { "Content-Type": "application/json" },
  }) as never);
  const payload = await response.json() as {
    code: string;
    likelyMigrationIssue: boolean;
    message: string;
    hint: string | null;
  };

  assert.equal(response.status, 503);
  assert.equal(payload.code, "MIGRATION_REQUIRED");
  assert.equal(payload.likelyMigrationIssue, true);
  assert.match(payload.message, /replay backtest/i);
  assert.match(payload.hint ?? "", /migrate:deploy/i);
});
