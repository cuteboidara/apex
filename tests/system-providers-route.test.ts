import assert from "node:assert/strict";
import test from "node:test";

import { createSystemProvidersRouteHandler } from "@/app/api/system/providers/route";
import { classifyProviderStatus } from "@/lib/providerStatusClassifier";

test("system providers route exposes the active price providers", async () => {
  const GET = createSystemProvidersRouteHandler({
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
        recordedAt: new Date().toISOString(),
      },
      {
        provider: "Binance",
        assetClass: "CRYPTO",
        score: 72,
        healthState: "DEGRADED",
        circuitState: "CLOSED",
        cooldownUntil: null,
        status: "degraded",
        detail: "HTTP 451 restricted location",
        latencyMs: 220,
        recordedAt: new Date().toISOString(),
      },
    ]) as never,
    classifyProviderStatus,
  });

  const response = await GET();
  const payload = await response.json() as { providers: Array<{ provider: string; status: string }> };

  assert.ok(payload.providers.some(provider => provider.provider === "Yahoo Finance"));
  assert.ok(payload.providers.some(provider => provider.provider === "Binance"));
  assert.ok(!payload.providers.some(provider => ["FCS API", "Alpha Vantage", "Twelve Data"].includes(provider.provider)));
  assert.equal(payload.providers.find(provider => provider.provider === "Binance")?.status, "degraded");
});
