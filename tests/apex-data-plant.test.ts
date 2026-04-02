import assert from "node:assert/strict";
import test from "node:test";

import { defaultMarketScopeConfig } from "@/src/config/marketScope";
import type { MarketDataProviderAdapter } from "@/src/data-plant/adapters";
import { DataPlant } from "@/src/data-plant/DataPlant";
import type { NormalizedCandle } from "@/src/interfaces/contracts";
import type { ApexConfig } from "@/src/lib/config";
import { resetRedisStateForTests } from "@/src/lib/redis";
import { ApexRepository } from "@/src/lib/repository";

const baseConfig: ApexConfig = {
  databaseUrl: undefined,
  redisUrl: undefined,
  telegramBotToken: undefined,
  telegramChatId: undefined,
  mode: "paper",
  cycleIntervalMinutes: 15,
  maxGrossExposure: 1,
  maxNetExposure: 0.5,
  drawdownWarningPct: 3,
  drawdownHardLimitPct: 5,
  maxSlippageBps: 15,
  marketScope: defaultMarketScopeConfig,
  activeSymbols: ["EURUSD"],
  primaryEntryStyle: "trend_pullback",
  enabledEntryStyles: ["trend_pullback", "session_breakout", "range_reversal"],
  disabledEntryStyles: [],
  pairProfiles: { ...defaultMarketScopeConfig.pairProfiles },
  scopeSkips: {
    symbols: [],
    pods: [],
  },
  activePods: ["trend", "breakout", "mean-reversion", "volatility-regime", "execution-advisory"],
  defaultVenue: "oanda",
  requireLiveData: true,
  blockHighVolChaotic: true,
  maxActiveSymbols: 6,
  maxSymbolPosition: 0.2,
  maxNotionalUsd: 100000,
  volatilityTarget: 0.3,
  defaultRecoveryMode: "normal",
  minimumTelegramGrade: "A",
  includeBTelegramSignals: false,
  showBlockedSignalsOnMainDashboard: false,
  showAdvancedInternals: false,
};

function buildYahooChartResponse() {
  return new Response(JSON.stringify({
    chart: {
      result: [{
        timestamp: [1_710_000_000, 1_710_000_900],
        indicators: {
          quote: [{
            open: [1.08, 1.081],
            high: [1.082, 1.083],
            low: [1.079, 1.08],
            close: [1.081, 1.082],
            volume: [1000, 1100],
          }],
        },
      }],
    },
  }), { status: 200 });
}

test("data plant uses OANDA as the primary FX provider when credentials are configured", async () => {
  resetRedisStateForTests();
  const originalFetch = globalThis.fetch;
  const originalRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("api-fxpractice.oanda.com")) {
      return new Response(JSON.stringify({
        candles: [
          {
            complete: true,
            time: "1710000000.000000000",
            volume: 1200,
            mid: { o: "1.0800", h: "1.0820", l: "1.0790", c: "1.0810" },
          },
          {
            complete: true,
            time: "1710000900.000000000",
            volume: 1250,
            mid: { o: "1.0810", h: "1.0830", l: "1.0800", c: "1.0820" },
          },
        ],
      }), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const repository = new ApexRepository();
    const dataPlant = new DataPlant(repository, {
      ...baseConfig,
      oandaApiToken: "test-token",
    });
    const event = await dataPlant.ingestOHLCV("EURUSD", "15min");

    assert.ok(event);
    assert.equal(event?.source, "oanda");
    assert.equal(repository.getMarketEvents("EURUSD").length, 2);
    assert.equal(repository.getFeedHealth().find(metric => metric.symbol_canonical === "EURUSD")?.provider, "oanda");
    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0] ?? "", /api-fxpractice\.oanda\.com/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRedisUrl == null) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  }
});

test("data plant falls back to Yahoo Finance when OANDA is unavailable", async () => {
  resetRedisStateForTests();
  const originalFetch = globalThis.fetch;
  const originalRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("api-fxpractice.oanda.com")) {
      throw new Error("oanda_down");
    }
    if (url.includes("finance.yahoo.com")) {
      return buildYahooChartResponse();
    }
    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const repository = new ApexRepository();
    const dataPlant = new DataPlant(repository, {
      ...baseConfig,
      oandaApiToken: "test-token",
    });
    const event = await dataPlant.ingestOHLCV("EURUSD", "15min");

    assert.ok(event);
    assert.equal(event?.source, "yahoo-finance");
    assert.ok(event?.session);
    assert.equal(repository.getMarketEvents("EURUSD").length, 2);
    assert.ok(requestedUrls.some(url => url.includes("api-fxpractice.oanda.com")));
    assert.ok(requestedUrls.some(url => url.includes("finance.yahoo.com")));
    assert.equal(repository.getSystemEvents().some(eventRow => eventRow.type === "market_data_fallback"), true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRedisUrl == null) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  }
});

test("data plant validates normalized candle quality flags and feed health", async () => {
  const repository = new ApexRepository();
  const now = Date.now();
  const stepMs = 15 * 60_000;
  const customAdapter: MarketDataProviderAdapter = {
    providerName: "test-oanda",
    fetchCandles: async () => ({
      provider: "test-oanda",
      candles: [
        {
          symbol: "EURUSD",
          timeframe: "15m",
          open: 1.08,
          high: 1.082,
          low: 1.079,
          close: 1.081,
          volume: 1000,
          timestampOpen: now - stepMs * 3,
          timestampClose: now - stepMs * 2,
          source: "test-oanda",
          qualityFlag: "clean",
          session: "london",
          tradingDay: "2026-03-25",
          hourBucket: 9,
          minutesSinceSessionOpen: 60,
          majorNewsFlag: false,
          minutesToNextHighImpactEvent: null,
          minutesSinceLastHighImpactEvent: null,
          eventType: null,
        },
        {
          symbol: "EURUSD",
          timeframe: "15m",
          open: 1.081,
          high: 1.083,
          low: 1.08,
          close: 1.082,
          volume: 1100,
          timestampOpen: now - stepMs,
          timestampClose: now,
          source: "test-oanda",
          qualityFlag: "clean",
          session: "london",
          tradingDay: "2026-03-25",
          hourBucket: 9,
          minutesSinceSessionOpen: 75,
          majorNewsFlag: false,
          minutesToNextHighImpactEvent: null,
          minutesSinceLastHighImpactEvent: null,
          eventType: null,
        },
        {
          symbol: "EURUSD",
          timeframe: "15m",
          open: 1.081,
          high: 1.083,
          low: 1.08,
          close: 1.082,
          volume: 1100,
          timestampOpen: now - stepMs,
          timestampClose: now,
          source: "test-oanda",
          qualityFlag: "clean",
          session: "london",
          tradingDay: "2026-03-25",
          hourBucket: 9,
          minutesSinceSessionOpen: 75,
          majorNewsFlag: false,
          minutesToNextHighImpactEvent: null,
          minutesSinceLastHighImpactEvent: null,
          eventType: null,
        },
      ] satisfies NormalizedCandle[],
      health: {
        provider: "test-oanda",
        latencyMs: 10,
        missingBars: 0,
        duplicateBars: 0,
        outOfOrderBars: 0,
        staleLastCandle: false,
        abnormalGapDetected: false,
      },
    }),
  };

  const dataPlant = new DataPlant(repository, baseConfig, {
    adapters: [customAdapter],
  });
  const event = await dataPlant.ingestOHLCV("EURUSD", "15min");
  const health = repository.getFeedHealth().find(metric => metric.symbol_canonical === "EURUSD");

  assert.ok(event);
  assert.equal(event?.qualityFlag, "duplicate_bars");
  assert.equal(repository.getMarketEvents("EURUSD").length, 2);
  assert.equal(health?.duplicate_bars, 1);
  assert.equal(health?.missing_bars, 1);
  assert.equal(health?.provider, "test-oanda");
});

test("data plant skips symbols outside the active market scope with a structured reason", async () => {
  const repository = new ApexRepository();
  const dataPlant = new DataPlant(repository, {
    ...baseConfig,
    requireLiveData: false,
  });

  const event = await dataPlant.ingestOHLCV("GBPUSD", "15min");

  assert.equal(event, null);
  assert.equal(repository.getFeedHealth().find(metric => metric.symbol_canonical === "GBPUSD")?.last_reason, "SYMBOL_NOT_ACTIVE");
});

test("data plant hydrates high-impact event context for downstream FX features", async () => {
  resetRedisStateForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("provider_down");
  }) as typeof fetch;

  try {
    const repository = new ApexRepository();
    const dataPlant = new DataPlant(repository, {
      ...baseConfig,
      requireLiveData: false,
    });
    dataPlant.replaceEconomicEvents([{
      ts: Date.now() + 10 * 60_000,
      eventType: "CPI",
      currencies: ["EUR", "USD"],
      impact: "high",
    }]);

    const event = await dataPlant.ingestOHLCV("EURUSD", "15min");

    assert.ok(event);
    assert.equal(event?.majorNewsFlag, true);
    assert.equal(event?.eventType, "CPI");
    assert.ok((event?.minutesToNextHighImpactEvent ?? 99) <= 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("data plant returns null when live data is required and Yahoo Finance is unavailable", async () => {
  resetRedisStateForTests();
  const originalFetch = globalThis.fetch;
  const originalRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  globalThis.fetch = (async () => {
    throw new Error("provider_down");
  }) as typeof fetch;

  try {
    const repository = new ApexRepository();
    const dataPlant = new DataPlant(repository, baseConfig);
    const event = await dataPlant.ingestOHLCV("EURUSD", "15min");

    assert.equal(event, null);
    assert.equal(repository.getMarketEvents("EURUSD").length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRedisUrl == null) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  }
});

test("data plant falls back to synthetic bars only when live-only enforcement is disabled", async () => {
  resetRedisStateForTests();
  const originalFetch = globalThis.fetch;
  const originalRedisUrl = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  globalThis.fetch = (async () => {
    throw new Error("provider_down");
  }) as typeof fetch;

  try {
    const repository = new ApexRepository();
    const dataPlant = new DataPlant(repository, {
      ...baseConfig,
      requireLiveData: false,
    });
    const event = await dataPlant.ingestOHLCV("EURUSD", "15min");

    assert.ok(event);
    assert.equal(event?.source, "synthetic");
    assert.equal(event?.qualityFlag, "synthetic");
    assert.equal(repository.getMarketEvents("EURUSD").length, 64);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRedisUrl == null) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
  }
});
