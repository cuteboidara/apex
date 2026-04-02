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
  const anthropic = classifyProviderStatus("error", "Credit balance is too low", "Anthropic");

  assert.equal(yahoo.availability, "available");
  assert.equal(yahoo.displayStatus, "available");
  assert.equal(binance.availability, "degraded");
  assert.equal(binance.displayStatus, "degraded");
  assert.equal(anthropic.availability, "degraded");
  assert.equal(anthropic.displayStatus, "degraded");
});

test("system route prefers Anthropic commentary when Claude is available", async () => {
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalDisableLlm = process.env.APEX_DISABLE_LLM;
  const originalCoreMode = process.env.APEX_CORE_SIGNAL_MODE;

  process.env.ANTHROPIC_API_KEY = "test-anthropic";
  process.env.APEX_DISABLE_LLM = "false";
  process.env.APEX_CORE_SIGNAL_MODE = "hybrid";

  try {
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
      commentary: {
        provider: string;
        detail: string;
      };
    };

    assert.equal(payload.commentary.provider, "Anthropic");
    assert.match(payload.commentary.detail, /Claude reasoning and market commentary/i);
  } finally {
    if (originalAnthropic == null) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropic;

    if (originalDisableLlm == null) delete process.env.APEX_DISABLE_LLM;
    else process.env.APEX_DISABLE_LLM = originalDisableLlm;

    if (originalCoreMode == null) delete process.env.APEX_CORE_SIGNAL_MODE;
    else process.env.APEX_CORE_SIGNAL_MODE = originalCoreMode;
  }
});

test("system route keeps core healthy when LLM providers fail and RSS is unavailable", async () => {
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalLlmOptional = process.env.APEX_LLM_OPTIONAL;
  const originalDisableLlm = process.env.APEX_DISABLE_LLM;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  process.env.ANTHROPIC_API_KEY = "test-anthropic";
  process.env.APEX_LLM_OPTIONAL = "true";
  process.env.APEX_DISABLE_LLM = "false";
  process.env.DATABASE_URL = "postgresql://test";

  try {
    const GET = createSystemRouteHandler({
      prisma: {
        providerHealth: {
          findMany: async () => ([
            {
              provider: "Anthropic",
              status: "ERROR",
              detail: "Credit balance is too low",
              requestSymbol: null,
              latencyMs: 160,
              recordedAt: new Date("2026-03-24T07:58:00.000Z"),
            },
            {
              provider: "RSS",
              status: "ERROR",
              detail: "rss_unavailable",
              requestSymbol: null,
              latencyMs: 300,
              recordedAt: new Date("2026-03-24T08:00:00.000Z"),
            },
          ]),
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
      getProviderSummaries: async () => ([
        {
          provider: "Yahoo Finance",
          assetClass: "FOREX",
          score: 98,
          healthState: "HEALTHY",
          circuitState: "CLOSED",
          cooldownUntil: null,
          status: "available",
          detail: "Primary forex provider",
          latencyMs: 120,
          recordedAt: new Date("2026-03-24T08:00:00.000Z").toISOString(),
        },
        {
          provider: "Yahoo Finance",
          assetClass: "COMMODITY",
          score: 96,
          healthState: "HEALTHY",
          circuitState: "CLOSED",
          cooldownUntil: null,
          status: "available",
          detail: "Primary metals provider",
          latencyMs: 140,
          recordedAt: new Date("2026-03-24T08:00:00.000Z").toISOString(),
        },
        {
          provider: "Binance",
          assetClass: "CRYPTO",
          score: 95,
          healthState: "HEALTHY",
          circuitState: "CLOSED",
          cooldownUntil: null,
          status: "available",
          detail: "Primary crypto provider",
          latencyMs: 90,
          recordedAt: new Date("2026-03-24T08:00:00.000Z").toISOString(),
        },
      ]) as never,
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
      getQueueConfiguration: () => ({ source: "redis" }) as never,
      getSignalCycleQueue: () => ({
        getJobCounts: async () => ({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
      }) as never,
      queueAvailable: true,
      queueUnavailableReason: null,
      getRuntimeCacheMode: () => "memory" as never,
      getRedisConfiguration: () => ({ source: "redis", restOnlyConfigured: false }) as never,
      isRedisConfigured: () => true,
    });

    const response = await GET();
    const payload = await response.json() as {
      status: string;
      core: { status: string };
      commentary: { status: string; mode: string; available: boolean };
      news: { status: string; available: boolean };
      blockedProviders: Array<{ provider: string }>;
    };

    assert.equal(payload.status, "ONLINE");
    assert.equal(payload.core.status, "available");
    assert.equal(payload.commentary.status, "degraded");
    assert.equal(payload.commentary.mode, "template");
    assert.equal(payload.commentary.available, true);
    assert.equal(payload.news.status, "degraded");
    assert.equal(payload.news.available, true);
    assert.deepEqual(payload.blockedProviders, []);
  } finally {
    if (originalAnthropic == null) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropic;

    if (originalLlmOptional == null) delete process.env.APEX_LLM_OPTIONAL;
    else process.env.APEX_LLM_OPTIONAL = originalLlmOptional;

    if (originalDisableLlm == null) delete process.env.APEX_DISABLE_LLM;
    else process.env.APEX_DISABLE_LLM = originalDisableLlm;

    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test("system route keeps core healthy when commentary and news are intentionally disabled", async () => {
  const originalDisableLlm = process.env.APEX_DISABLE_LLM;
  const originalDisableNews = process.env.APEX_DISABLE_NEWS;
  const originalLlmOptional = process.env.APEX_LLM_OPTIONAL;
  const originalCoreMode = process.env.APEX_CORE_SIGNAL_MODE;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  process.env.APEX_DISABLE_LLM = "true";
  process.env.APEX_DISABLE_NEWS = "true";
  process.env.APEX_LLM_OPTIONAL = "true";
  process.env.APEX_CORE_SIGNAL_MODE = "deterministic";
  process.env.DATABASE_URL = "postgresql://test";

  try {
    const GET = createSystemRouteHandler({
      prisma: {
        providerHealth: {
          findMany: async () => [],
        },
        signalRun: {
          count: async () => 1,
          findFirst: async () => null,
        },
        signal: {
          count: async () => 13,
        },
        tradePlan: {
          count: async () => 39,
          findMany: async () => [],
        },
        alert: {
          count: async () => 0,
        },
      } as never,
      getProviderSummaries: async () => ([
        {
          provider: "Yahoo Finance",
          assetClass: "FOREX",
          score: 99,
          healthState: "HEALTHY",
          circuitState: "CLOSED",
          cooldownUntil: null,
          status: "available",
          detail: "Primary forex provider",
          latencyMs: 110,
          recordedAt: new Date("2026-03-24T08:00:00.000Z").toISOString(),
        },
        {
          provider: "Yahoo Finance",
          assetClass: "COMMODITY",
          score: 98,
          healthState: "HEALTHY",
          circuitState: "CLOSED",
          cooldownUntil: null,
          status: "available",
          detail: "Primary metals provider",
          latencyMs: 120,
          recordedAt: new Date("2026-03-24T08:00:00.000Z").toISOString(),
        },
        {
          provider: "Binance",
          assetClass: "CRYPTO",
          score: 97,
          healthState: "HEALTHY",
          circuitState: "CLOSED",
          cooldownUntil: null,
          status: "available",
          detail: "Primary crypto provider",
          latencyMs: 90,
          recordedAt: new Date("2026-03-24T08:00:00.000Z").toISOString(),
        },
      ]) as never,
      recordProviderHealth: async () => undefined,
      classifyProviderStatus,
      buildLatestSetupBreakdown: () => ({
        runId: null,
        long: 0,
        short: 0,
        noSetup: 13,
        active: 0,
        stale: 0,
        total: 13,
        directionBalance: "BALANCED",
        generatedAt: null,
      }) as never,
      getQueueConfiguration: () => ({ source: "redis" }) as never,
      getSignalCycleQueue: () => ({
        getJobCounts: async () => ({ waiting: 0, active: 0, completed: 2, failed: 0, delayed: 0 }),
      }) as never,
      queueAvailable: true,
      queueUnavailableReason: null,
      getRuntimeCacheMode: () => "memory" as never,
      getRedisConfiguration: () => ({ source: "redis", restOnlyConfigured: false }) as never,
      isRedisConfigured: () => true,
    });

    const response = await GET();
    const payload = await response.json() as {
      status: string;
      core: { status: string };
      commentary: { status: string; mode: string; detail: string; available: boolean };
      news: { status: string; detail: string; available: boolean };
      runtime: { coreSignalMode: string; llmDisabled: boolean; newsDisabled: boolean };
    };

    assert.equal(response.status, 200);
    assert.equal(payload.status, "ONLINE");
    assert.equal(payload.core.status, "available");
    assert.equal(payload.commentary.status, "degraded");
    assert.equal(payload.commentary.mode, "disabled");
    assert.equal(payload.commentary.available, true);
    assert.match(payload.commentary.detail, /disabled/i);
    assert.equal(payload.news.status, "degraded");
    assert.equal(payload.news.available, true);
    assert.match(payload.news.detail, /disabled/i);
    assert.equal(payload.runtime.coreSignalMode, "deterministic");
    assert.equal(payload.runtime.llmDisabled, true);
    assert.equal(payload.runtime.newsDisabled, true);
  } finally {
    if (originalDisableLlm == null) delete process.env.APEX_DISABLE_LLM;
    else process.env.APEX_DISABLE_LLM = originalDisableLlm;

    if (originalDisableNews == null) delete process.env.APEX_DISABLE_NEWS;
    else process.env.APEX_DISABLE_NEWS = originalDisableNews;

    if (originalLlmOptional == null) delete process.env.APEX_LLM_OPTIONAL;
    else process.env.APEX_LLM_OPTIONAL = originalLlmOptional;

    if (originalCoreMode == null) delete process.env.APEX_CORE_SIGNAL_MODE;
    else process.env.APEX_CORE_SIGNAL_MODE = originalCoreMode;

    if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }
});
