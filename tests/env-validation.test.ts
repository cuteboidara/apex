import assert from "node:assert/strict";
import test from "node:test";

import { validateRuntimeEnv } from "@/scripts/validate-env.mjs";

test("worker env validation rejects rest-only redis configuration", () => {
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = "postgresql://example";
  delete process.env.REDIS_URL;
  delete process.env.KV_URL;
  delete process.env.UPSTASH_REDIS_URL;
  delete process.env.UPSTASH_REDIS_TLS_URL;
  process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "token";

  const report = validateRuntimeEnv({ service: "worker", strict: true });

  process.env = originalEnv;

  assert.ok(report.errors.some(error => error.includes("BullMQ requires")));
});
