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

test("web env validation warns instead of failing when Twelve Data is missing", () => {
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = "postgresql://example";
  process.env.NEXTAUTH_SECRET = "a".repeat(32);
  process.env.NEXTAUTH_URL = "https://apex.example.com";
  process.env.APEX_SECRET = "shared-secret";
  process.env.TELEGRAM_BOT_TOKEN = "token";
  process.env.TELEGRAM_CHAT_ID = "chat";
  delete process.env.TWELVE_DATA_API_KEY;

  const report = validateRuntimeEnv({ service: "web", strict: true });

  process.env = originalEnv;

  assert.ok(report.warnings.some(warning => warning.includes("Missing TWELVE_DATA_API_KEY")));
  assert.equal(report.errors.length, 0);
});

test("web env validation warns when Anthropic is unavailable but does not fail startup", () => {
  const originalEnv = { ...process.env };
  process.env.DATABASE_URL = "postgresql://example";
  process.env.NEXTAUTH_SECRET = "a".repeat(32);
  process.env.NEXTAUTH_URL = "https://apex.example.com";
  process.env.APEX_SECRET = "shared-secret";
  process.env.TELEGRAM_BOT_TOKEN = "token";
  process.env.TELEGRAM_CHAT_ID = "chat";
  delete process.env.ANTHROPIC_API_KEY;

  const report = validateRuntimeEnv({ service: "web", strict: true });

  process.env = originalEnv;

  assert.ok(report.warnings.some(error => error.includes("Missing ANTHROPIC_API_KEY")));
  assert.equal(report.errors.length, 0);
});
