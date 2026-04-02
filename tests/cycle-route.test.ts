import assert from "node:assert/strict";
import test from "node:test";

import { createCycleRouteHandler } from "@/app/api/cycle/route";

test("/api/cycle rejects requests when APEX_SECRET is not configured", async () => {
  const POST = createCycleRouteHandler({
    getRuntime: (() => {
      throw new Error("should not be called");
    }) as never,
    apexSecret: undefined,
  });

  const response = await POST(new Request("http://localhost/api/cycle", {
    method: "POST",
  }) as never);
  const payload = await response.json() as { error: string };

  assert.equal(response.status, 500);
  assert.equal(payload.error, "APEX_SECRET not configured");
});

test("/api/cycle rejects requests with missing or invalid auth headers", async () => {
  const POST = createCycleRouteHandler({
    getRuntime: (() => {
      throw new Error("should not be called");
    }) as never,
    apexSecret: "top-secret",
  });

  const response = await POST(new Request("http://localhost/api/cycle", {
    method: "POST",
  }) as never);
  const payload = await response.json() as { error: string };

  assert.equal(response.status, 401);
  assert.equal(payload.error, "Unauthorized");
});

test("/api/cycle runs when x-apex-secret matches APEX_SECRET", async () => {
  const POST = createCycleRouteHandler({
    getRuntime: () => ({
      config: { mode: "paper" },
      engine: {
        queueCycle: async () => ({
          queued: false,
          result: {
            cycle_id: "cycle_1",
            timestamp: 123,
            symbols: [],
          },
        }),
      },
    }) as never,
    apexSecret: "top-secret",
  });

  const response = await POST(new Request("http://localhost/api/cycle", {
    method: "POST",
    headers: {
      "x-apex-secret": "top-secret",
    },
  }) as never);
  const payload = await response.json() as {
    success: boolean;
    queued: boolean;
    cycle_id: string;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.queued, false);
  assert.equal(payload.cycle_id, "cycle_1");
});

test("/api/cycle GET runs with the same secret-header guard as POST", async () => {
  const GET = createCycleRouteHandler({
    getRuntime: () => ({
      config: { mode: "paper" },
      engine: {
        queueCycle: async () => ({
          queued: true,
          jobId: "job_1",
        }),
      },
    }) as never,
    apexSecret: "top-secret",
  });

  const response = await GET(new Request("http://localhost/api/cycle", {
    method: "GET",
    headers: {
      "x-apex-secret": "top-secret",
    },
  }) as never);
  const payload = await response.json() as {
    success: boolean;
    queued: boolean;
    job_id: string;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.queued, true);
  assert.equal(payload.job_id, "job_1");
});

test("/api/cycle runs when Authorization bearer matches APEX_SECRET", async () => {
  const POST = createCycleRouteHandler({
    getRuntime: () => ({
      config: { mode: "paper" },
      engine: {
        queueCycle: async () => ({
          queued: false,
          result: {
            cycle_id: "cycle_bearer",
            timestamp: 456,
            symbols: [],
          },
        }),
      },
    }) as never,
    apexSecret: "top-secret",
  });

  const response = await POST(new Request("http://localhost/api/cycle", {
    method: "POST",
    headers: {
      Authorization: "Bearer top-secret",
    },
  }) as never);
  const payload = await response.json() as {
    queued: boolean;
    cycle_id: string;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.queued, false);
  assert.equal(payload.cycle_id, "cycle_bearer");
});
