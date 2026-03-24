import assert from "node:assert/strict";
import test from "node:test";

import { resolveSignalExplanation } from "@/lib/apexEngine";
import { fetchNewsBundle } from "@/lib/marketData";
import { createRunCycle } from "@/lib/scheduler";
import { getCoreSignalRuntime } from "@/lib/runtime/featureFlags";

test("fetchNewsBundle returns empty deterministic news context when news is disabled", async () => {
  const originalDisableNews = process.env.APEX_DISABLE_NEWS;
  const originalCoreMode = process.env.APEX_CORE_SIGNAL_MODE;
  const originalFetch = globalThis.fetch;

  process.env.APEX_DISABLE_NEWS = "true";
  process.env.APEX_CORE_SIGNAL_MODE = "deterministic";
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called when news is disabled");
  };

  try {
    const bundle = await fetchNewsBundle("BTCUSDT");

    assert.deepEqual(bundle.articles, []);
    assert.equal(bundle.reason, "news_disabled");
    assert.equal(bundle.degraded, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDisableNews == null) delete process.env.APEX_DISABLE_NEWS;
    else process.env.APEX_DISABLE_NEWS = originalDisableNews;

    if (originalCoreMode == null) delete process.env.APEX_CORE_SIGNAL_MODE;
    else process.env.APEX_CORE_SIGNAL_MODE = originalCoreMode;
  }
});

test("resolveSignalExplanation falls back to deterministic brief when explanation generation throws", async () => {
  const originalDisableLlm = process.env.APEX_DISABLE_LLM;
  const originalCoreMode = process.env.APEX_CORE_SIGNAL_MODE;

  process.env.APEX_DISABLE_LLM = "false";
  process.env.APEX_CORE_SIGNAL_MODE = "hybrid";

  let failureReason = "";

  try {
    const explanation = await resolveSignalExplanation({
      symbol: "EURUSD",
      rank: "A",
      direction: "LONG",
      deterministicBrief: "Deterministic fallback brief.",
      runtime: getCoreSignalRuntime(),
      narrativeInput: {
        template: {
          symbol: "EURUSD",
          assetClass: "FOREX",
          direction: "LONG",
          rank: "A",
          style: "INTRADAY",
          setupFamily: "Breakout",
          regimeTag: "trend",
          status: "ACTIVE",
          diagnostics: [],
          provider: "Yahoo Finance",
          providerHealthState: "HEALTHY",
          marketStatus: "LIVE",
          fallbackUsed: false,
          freshnessClass: "fresh",
          entry: 1.1,
          stopLoss: 1.09,
          tp1: 1.11,
          tp2: 1.12,
          tp3: 1.13,
          reason: "Test",
        },
        prompt: {
          system: "system",
          user: "user",
          maxTokens: 32,
          requestId: "EURUSD",
        },
        mode: "auto",
      },
      generateNarrative: async () => {
        throw new Error("llm cache write failed");
      },
      onFailure: error => {
        failureReason = String(error);
      },
    });

    assert.equal(explanation.status, "template");
    assert.equal(explanation.degradedReason, "explanation_error");
    assert.equal(explanation.text, "Deterministic fallback brief.");
    assert.match(failureReason, /llm cache write failed/i);
  } finally {
    if (originalDisableLlm == null) delete process.env.APEX_DISABLE_LLM;
    else process.env.APEX_DISABLE_LLM = originalDisableLlm;

    if (originalCoreMode == null) delete process.env.APEX_CORE_SIGNAL_MODE;
    else process.env.APEX_CORE_SIGNAL_MODE = originalCoreMode;
  }
});

test("scheduler runCycle completes cleanly with zero signals in deterministic mode", async () => {
  const updates: Array<Record<string, unknown>> = [];
  let alertCalls = 0;

  const runCycle = createRunCycle({
    prisma: {
      signalRun: {
        findUnique: async () => ({
          startedAt: new Date("2026-03-24T10:00:00.000Z"),
          queuedAt: new Date("2026-03-24T10:00:00.000Z"),
        }),
      },
    } as never,
    runFullCycle: async runId => ({
      runId: String(runId ?? "run_test"),
      signals: [],
      metrics: {
        dataFetchDurationMs: 0,
        scoringDurationMs: 0,
        persistenceDurationMs: 0,
      },
    }),
    sendSignal: async () => {
      alertCalls += 1;
    },
    recordAuditEvent: async () => undefined,
    ensureSignalRunRecord: async runId => ({
      id: String(runId ?? "run_test"),
      queuedAt: new Date("2026-03-24T10:00:00.000Z"),
      startedAt: new Date("2026-03-24T10:00:00.000Z"),
      status: "QUEUED",
    }) as never,
    updateSignalRunWithRecovery: async (_runId, data) => {
      updates.push(data as Record<string, unknown>);
      return undefined as never;
    },
  });

  const result = await runCycle("run_test");

  assert.equal(result.runId, "run_test");
  assert.deepEqual(result.signals, []);
  assert.equal(alertCalls, 0);
  assert.ok(updates.some(update => update.status === "COMPLETED"));
});
