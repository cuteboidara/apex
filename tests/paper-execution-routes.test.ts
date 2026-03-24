import assert from "node:assert/strict";
import test from "node:test";

import { createExecutionAccountsRouteHandlers } from "@/app/api/execution/accounts/route";
import { createExecutionPositionsRouteHandlers } from "@/app/api/execution/positions/route";

test("paper execution account route returns the current user's paper account", async () => {
  const audits: string[] = [];
  const route = createExecutionAccountsRouteHandlers({
    getSession: async () => ({ user: { id: "user_1" } }) as never,
    listPaperAccounts: async () => ([
      { id: "acct_1", name: "Primary Paper Account" },
    ]) as never,
    getOrCreatePaperAccount: async () => ({
      id: "acct_1",
      name: "Primary Paper Account",
      isDefault: true,
    }) as never,
    recordAuditEvent: async input => {
      audits.push(input.action);
    },
  });

  const response = await route.POST(new Request("http://localhost/api/execution/accounts", {
    method: "POST",
    body: JSON.stringify({ name: "Desk Account" }),
    headers: { "Content-Type": "application/json" },
  }) as never);
  const payload = await response.json() as { account: { id: string } };

  assert.equal(response.status, 200);
  assert.equal(payload.account.id, "acct_1");
  assert.deepEqual(audits, ["paper_account_accessed"]);
});

test("paper execution positions route records audit history for trade execution", async () => {
  const audits: string[] = [];
  const route = createExecutionPositionsRouteHandlers({
    getSession: async () => ({ user: { id: "user_1" } }) as never,
    prisma: {
      paperPosition: {
        findMany: async () => [],
      },
    } as never,
    listPaperAccounts: async () => ([{ id: "acct_1" }]) as never,
    openPaperPositionFromTradePlan: async () => ({
      accountId: "acct_1",
      position: { id: "pos_1" },
    }) as never,
    markPaperPosition: async () => ({
      id: "pos_1",
      unrealizedPnl: 12,
    }) as never,
    closePaperPosition: async () => ({
      id: "pos_1",
      realizedPnl: 18,
    }) as never,
    recordAuditEvent: async input => {
      audits.push(input.action);
    },
  });

  const response = await route.POST(new Request("http://localhost/api/execution/positions", {
    method: "POST",
    body: JSON.stringify({ action: "execute_trade_plan", tradePlanId: "plan_1" }),
    headers: { "Content-Type": "application/json" },
  }) as never);
  const payload = await response.json() as { position: { id: string } };

  assert.equal(response.status, 200);
  assert.equal(payload.position.id, "pos_1");
  assert.deepEqual(audits, ["paper_trade_executed"]);
});

test("paper execution accounts route returns structured migration errors", async () => {
  const route = createExecutionAccountsRouteHandlers({
    getSession: async () => ({ user: { id: "user_1" } }) as never,
    listPaperAccounts: async () => {
      const error = new Error("The table `PaperAccount` does not exist in the current database.") as Error & { code?: string };
      error.code = "P2021";
      throw error;
    },
    getOrCreatePaperAccount: async () => {
      throw new Error("not used");
    },
    recordAuditEvent: async () => undefined,
  });

  const response = await route.GET();
  const payload = await response.json() as {
    message: string;
    code: string;
    likelyMigrationIssue: boolean;
    hint: string | null;
  };

  assert.equal(response.status, 503);
  assert.equal(payload.code, "MIGRATION_REQUIRED");
  assert.equal(payload.likelyMigrationIssue, true);
  assert.match(payload.message, /paper trading accounts/i);
  assert.match(payload.hint ?? "", /migrate:deploy/i);
});

test("paper execution positions route returns structured migration errors on load", async () => {
  const route = createExecutionPositionsRouteHandlers({
    getSession: async () => ({ user: { id: "user_1" } }) as never,
    prisma: {
      paperPosition: {
        findMany: async () => {
          const error = new Error("The table `PaperPosition` does not exist in the current database.") as Error & { code?: string };
          error.code = "P2021";
          throw error;
        },
      },
    } as never,
    listPaperAccounts: async () => ([{ id: "acct_1" }]) as never,
    openPaperPositionFromTradePlan: async () => {
      throw new Error("not used");
    },
    markPaperPosition: async () => {
      throw new Error("not used");
    },
    closePaperPosition: async () => {
      throw new Error("not used");
    },
    recordAuditEvent: async () => undefined,
  });

  const response = await route.GET(new Request("http://localhost/api/execution/positions") as never);
  const payload = await response.json() as {
    message: string;
    code: string;
    likelyMigrationIssue: boolean;
    hint: string | null;
  };

  assert.equal(response.status, 503);
  assert.equal(payload.code, "MIGRATION_REQUIRED");
  assert.equal(payload.likelyMigrationIssue, true);
  assert.match(payload.message, /paper trading positions/i);
  assert.match(payload.hint ?? "", /migrate:deploy/i);
});
