import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

import { createAdminStatsRouteHandler } from "@/app/api/admin/stats/route";

test("admin stats route blocks unauthorized requests", async () => {
  const GET = createAdminStatsRouteHandler({
    prisma: {} as never,
    requireAdmin: async () => ({
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    }),
  });

  const response = await GET();
  const payload = await response.json() as { error: string };

  assert.equal(response.status, 403);
  assert.equal(payload.error, "Forbidden");
});

test("admin stats route returns AMT command center payload", async () => {
  const GET = createAdminStatsRouteHandler({
    prisma: {
      indicesSignal: {
        count: async (input?: { where?: { totalScore?: { gte?: number; lt?: number } } }) => {
          const where = input?.where?.totalScore;
          if (where?.gte === 60) return 8;
          if (where?.gte === 40 && where?.lt === 60) return 3;
          return 11;
        },
        aggregate: async () => ({ _avg: { totalScore: 66.4 } }),
        findMany: async () => ([
          { assetId: "EURUSD", smcSetupJson: { setupType: "breakout_acceptance" } },
          { assetId: "EURUSD", smcSetupJson: { setupType: "failed_auction_long" } },
          { assetId: "GBPUSD", smcSetupJson: { setupType: "breakout_acceptance" } },
        ]),
        findFirst: async () => ({ createdAt: new Date("2026-03-29T13:15:00.000Z") }),
      },
      indicesAssetState: {
        count: async () => 11,
      },
      user: {
        count: async (input?: { where?: { status?: string; lastLoginAt?: { gte: Date }; createdAt?: { gte: Date } } }) => {
          if (input?.where?.status === "PENDING") return 2;
          if (input?.where?.lastLoginAt?.gte) return 5;
          if (input?.where?.createdAt?.gte) return 1;
          return 23;
        },
      },
    } as never,
    requireAdmin: async () => ({ ok: true as const }),
    fetchMacroContextFn: async () => ({
      dxy: { trend: "down", price: 101.2 },
      vix: { price: 18.4 },
      economicEvents: [{}, {}],
    }) as never,
  });

  const response = await GET();
  const payload = await response.json() as {
    runtimeStatus: string;
    assetsScanned: number;
    totalSignals: number;
    executableSignals: number;
    watchlistSignals: number;
    avgScore: number;
    signalsByAsset: Record<string, number>;
    signalsBySetup: Record<string, number>;
    totalUsers: number;
    activeUsers: number;
    pendingApprovals: number;
    newUsersToday: number;
    macroRegime: string;
    dxy: number;
    vix: number;
    eventRisk: number;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.totalSignals, 11);
  assert.equal(payload.executableSignals, 8);
  assert.equal(payload.watchlistSignals, 3);
  assert.equal(payload.avgScore, 66.4);
  assert.equal(payload.signalsByAsset.EURUSD, 2);
  assert.equal(payload.signalsBySetup.breakout_acceptance, 2);
  assert.equal(payload.totalUsers, 23);
  assert.equal(payload.activeUsers, 5);
  assert.equal(payload.pendingApprovals, 2);
  assert.equal(payload.newUsersToday, 1);
  assert.equal(payload.assetsScanned, 11);
  assert.equal(payload.macroRegime, "DOWN");
  assert.equal(payload.dxy, 101.2);
  assert.equal(payload.vix, 18.4);
  assert.equal(payload.eventRisk, 2);
});
