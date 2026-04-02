import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";

import { createAllAssetsCycleTriggerRouteHandler } from "@/app/api/all-assets-cycle-trigger/route";
import { createCycleTriggerRouteHandler } from "@/app/api/cycle-trigger/route";
import { createOpsModeRouteHandler } from "@/app/api/ops/mode/route";
import { createOpsReplayRouteHandler } from "@/app/api/ops/replay/route";
import { createKillSwitchRouteHandler } from "@/app/api/system/kill-switch/route";

async function denyOperator() {
  return {
    ok: false as const,
    response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  };
}

async function allowOperator() {
  return {
    ok: true as const,
    session: {
      user: {
        id: "user_1",
        email: "operator@example.com",
      },
    },
  };
}

test("operator control routes reject anonymous callers", async () => {
  let cycleCalled = false;
  let modeCalled = false;
  let replayCalled = false;
  let killSwitchCalled = false;

  const cycleRoute = createCycleTriggerRouteHandler({
    apexSecret: "top-secret",
    requireOperator: denyOperator as never,
    triggerCycle: (async () => {
      cycleCalled = true;
      return NextResponse.json({ ok: true });
    }) as never,
  });
  const modeRoute = createOpsModeRouteHandler({
    requireOperator: denyOperator as never,
    setRecoveryModePayload: (async () => {
      modeCalled = true;
      return { mode: "normal" };
    }) as never,
  });
  const replayRoute = createOpsReplayRouteHandler({
    requireOperator: denyOperator as never,
    replayPayload: (async () => {
      replayCalled = true;
      return { ok: true };
    }) as never,
  });
  const killSwitchRoute = createKillSwitchRouteHandler({
    requireOperator: denyOperator as never,
    toggleKillSwitchPayload: (async () => {
      killSwitchCalled = true;
      return { kill_switch_active: true };
    }) as never,
  });

  const [cycleResponse, modeResponse, replayResponse, killSwitchResponse] = await Promise.all([
    cycleRoute(new Request("http://localhost/api/cycle-trigger", { method: "POST" }) as never),
    modeRoute(new Request("http://localhost/api/ops/mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "normal" }),
    }) as never),
    replayRoute(new Request("http://localhost/api/ops/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "EURUSD", from_ts: 1, to_ts: 2 }),
    }) as never),
    killSwitchRoute(new Request("http://localhost/api/system/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    }) as never),
  ]);

  assert.equal(cycleResponse.status, 401);
  assert.equal(modeResponse.status, 401);
  assert.equal(replayResponse.status, 401);
  assert.equal(killSwitchResponse.status, 401);
  assert.equal(cycleCalled, false);
  assert.equal(modeCalled, false);
  assert.equal(replayCalled, false);
  assert.equal(killSwitchCalled, false);
});

test("/api/cycle-trigger injects the server secret only after operator auth succeeds", async () => {
  let forwardedSecret: string | null = null;
  let forwardedAuthorization: string | null = null;

  const cycleRoute = createCycleTriggerRouteHandler({
    apexSecret: "top-secret",
    requireOperator: allowOperator as never,
    triggerCycle: (async (request: Request) => {
      forwardedSecret = request.headers.get("x-apex-secret");
      forwardedAuthorization = request.headers.get("authorization");
      return NextResponse.json({ success: true, queued: true, job_id: "job_1" });
    }) as never,
  });

  const response = await cycleRoute(new Request("http://localhost/api/cycle-trigger", {
    method: "POST",
    headers: {
      authorization: "Bearer user-supplied-secret",
    },
  }) as never);
  const payload = await response.json() as { success: boolean; queued: boolean; job_id: string };

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.queued, true);
  assert.equal(payload.job_id, "job_1");
  assert.equal(forwardedSecret, "top-secret");
  assert.equal(forwardedAuthorization, null);
});

test("/api/cycle-trigger fans out all asset modules when direct orchestration is enabled", async () => {
  let orchestrated = false;

  const cycleRoute = createCycleTriggerRouteHandler({
    apexSecret: undefined,
    requireOperator: allowOperator as never,
    triggerAllAssets: (async () => {
      orchestrated = true;
      return {
        success: true,
        partial: false,
        okCount: 5,
        failureCount: 0,
        queuedCount: 1,
        completedCount: 4,
        failedModules: [],
        modules: {
          forex: { ok: true, status: "queued", cycleId: null, jobId: "job_fx", cardCount: null },
          crypto: { ok: true, status: "completed", cycleId: "crypto_1", cardCount: 2 },
          stocks: { ok: true, status: "completed", cycleId: "stocks_1", cardCount: 6 },
          commodities: { ok: true, status: "completed", cycleId: "commodities_1", cardCount: 4 },
          indices: { ok: true, status: "completed", cycleId: "indices_1", cardCount: 4 },
          memecoins: { ok: true, status: "completed", cycleId: "meme_1", cardCount: 8, universeSize: 20 },
        },
      };
    }) as never,
  });

  const response = await cycleRoute(new Request("http://localhost/api/cycle-trigger", {
    method: "POST",
  }) as never);
  const payload = await response.json() as {
    success: boolean;
    okCount: number;
    queuedCount: number;
    completedCount: number;
  };

  assert.equal(response.status, 200);
  assert.equal(orchestrated, true);
  assert.equal(payload.success, true);
  assert.equal(payload.okCount, 5);
  assert.equal(payload.queuedCount, 1);
  assert.equal(payload.completedCount, 4);
});

test("/api/all-assets-cycle-trigger rejects anonymous callers", async () => {
  let called = false;

  const route = createAllAssetsCycleTriggerRouteHandler({
    requireOperator: denyOperator as never,
    getRuntime: (() => ({ engine: {} })) as never,
    queueForexCycle: (async () => {
      called = true;
      throw new Error("should not run");
    }) as never,
  });

  const response = await route(new Request("http://localhost/api/all-assets-cycle-trigger", {
    method: "POST",
  }) as never);

  assert.equal(response.status, 401);
  assert.equal(called, false);
});

test("/api/all-assets-cycle-trigger runs every module and tolerates partial failures", async () => {
  const route = createAllAssetsCycleTriggerRouteHandler({
    requireOperator: allowOperator as never,
    getRuntime: (() => ({
      engine: {},
    })) as never,
    queueForexCycle: (async () => ({
      queued: true,
      jobId: "job_forex",
    })) as never,
    triggerCrypto: (async () => ({
      cycleId: "crypto_1",
      cardCount: 2,
    })) as never,
    triggerStocks: (async () => ({
      cycleId: "stocks_1",
      cardCount: 6,
    })) as never,
    triggerCommodities: (async () => {
      throw new Error("commodities unavailable");
    }) as never,
    triggerIndices: (async () => ({
      cycleId: "indices_1",
      cardCount: 4,
    })) as never,
    triggerMeme: (async () => ({
      cycleId: "meme_1",
      cardCount: 8,
      universeSize: 20,
    })) as never,
  });

  const response = await route(new Request("http://localhost/api/all-assets-cycle-trigger", {
    method: "POST",
  }) as never);
  const payload = await response.json() as {
    success: boolean;
    partial: boolean;
    okCount: number;
    failureCount: number;
    queuedCount: number;
    completedCount: number;
    failedModules: string[];
    modules: Record<string, {
      ok: boolean;
      status: string;
      cycleId: string | null;
      jobId?: string | null;
      cardCount?: number | null;
      universeSize?: number | null;
      error?: string;
    }>;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.success, false);
  assert.equal(payload.partial, true);
  assert.equal(payload.okCount, 5);
  assert.equal(payload.failureCount, 1);
  assert.equal(payload.queuedCount, 1);
  assert.equal(payload.completedCount, 4);
  assert.deepEqual(payload.failedModules, ["commodities"]);
  assert.deepEqual(payload.modules.forex, {
    ok: true,
    status: "queued",
    cycleId: null,
    jobId: "job_forex",
    cardCount: null,
  });
  assert.equal(payload.modules.commodities.ok, false);
  assert.equal(payload.modules.commodities.status, "failed");
  assert.equal(payload.modules.commodities.error, "commodities unavailable");
  assert.equal(payload.modules.memecoins.universeSize, 20);
});
