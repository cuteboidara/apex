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

test("admin stats route returns persisted overview data without live runtime dependencies", async () => {
  const GET = createAdminStatsRouteHandler({
    prisma: {
      user: {
        count: async (input?: { where?: { status?: string; lastLoginAt?: { gte: Date } } }) => {
          if (input?.where?.status === "PENDING") return 2;
          if (input?.where?.status === "BANNED") return 1;
          if (input?.where?.lastLoginAt?.gte) return 3;
          return 7;
        },
        findMany: async () => ([
          {
            id: "user_1",
            name: "Trader One",
            email: "trader@example.com",
            status: "APPROVED",
            createdAt: new Date("2026-03-29T12:00:00.000Z"),
          },
        ]),
      },
      signal: {
        count: async (input?: { where?: { rank?: string | { in: string[] } } }) => {
          if (input?.where?.rank === "B") return 4;
          if (input?.where?.rank === "A") return 3;
          if (typeof input?.where?.rank === "object") return 2;
          return 9;
        },
        findMany: async () => ([
          {
            id: "sig_1",
            asset: "EURUSD",
            direction: "LONG",
            rank: "A",
            total: 82,
            createdAt: new Date("2026-03-29T13:15:00.000Z"),
          },
        ]),
      },
    } as never,
    requireAdmin: async () => ({ ok: true as const }),
  });

  const response = await GET();
  const payload = await response.json() as {
    ok: boolean;
    users: { total: number; pending: number; activeToday: number; banned: number };
    signals: { total: number; b: number; a: number; s: number };
    recentUsers: Array<{ id: string; email: string }>;
    recentSignals: Array<{ id: string; asset: string; direction: string; rank: string; total: number }>;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.users, {
    total: 7,
    pending: 2,
    activeToday: 3,
    banned: 1,
  });
  assert.deepEqual(payload.signals, {
    total: 9,
    b: 4,
    a: 3,
    s: 2,
  });
  assert.equal(payload.recentUsers[0]?.email, "trader@example.com");
  assert.deepEqual(payload.recentSignals[0], {
    id: "sig_1",
    asset: "EURUSD",
    direction: "LONG",
    rank: "A",
    total: 82,
    createdAt: "2026-03-29T13:15:00.000Z",
  });
});
