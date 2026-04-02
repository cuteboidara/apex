import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderHealth } from "@prisma/client";

import { scoreProviderReliability, summarizeProviderHealthRows } from "@/src/application/analytics/providerDiagnostics";

test("provider reliability scoring penalizes degraded, empty-body, and slow providers", () => {
  const healthyFast = scoreProviderReliability({
    attempts: 20,
    successes: 18,
    degradedResponses: 1,
    emptyBodyResponses: 0,
    averageLatencyMs: 120,
  });
  const degradedSlow = scoreProviderReliability({
    attempts: 20,
    successes: 10,
    degradedResponses: 6,
    emptyBodyResponses: 5,
    averageLatencyMs: 900,
  });

  assert.ok(healthyFast > degradedSlow);
  assert.ok(healthyFast > 70);
  assert.ok(degradedSlow < 60);
});

test("provider diagnostics summarize recent reliability per asset class and preserve empty-body penalties", () => {
  const now = new Date("2026-03-29T12:00:00.000Z");
  const rows: ProviderHealth[] = [
    {
      id: "ph_1",
      provider: "Yahoo",
      status: "healthy",
      latencyMs: 180,
      errorRate: null,
      quotaRemaining: null,
      recordedAt: now,
      requestSymbol: null,
      detail: "asset=commodity price=ok",
    },
    {
      id: "ph_2",
      provider: "Yahoo",
      status: "healthy",
      latencyMs: 210,
      errorRate: null,
      quotaRemaining: null,
      recordedAt: new Date("2026-03-29T11:59:00.000Z"),
      requestSymbol: null,
      detail: "asset=commodity price=ok",
    },
    {
      id: "ph_3",
      provider: "Stooq",
      status: "empty_body",
      latencyMs: 550,
      errorRate: null,
      quotaRemaining: null,
      recordedAt: new Date("2026-03-29T11:58:00.000Z"),
      requestSymbol: "SPX",
      detail: "asset=index empty_body",
    },
    {
      id: "ph_4",
      provider: "Stooq",
      status: "no_data",
      latencyMs: 600,
      errorRate: null,
      quotaRemaining: null,
      recordedAt: new Date("2026-03-29T11:57:00.000Z"),
      requestSymbol: "SPX",
      detail: "asset=index no_data",
    },
  ];

  const summaries = summarizeProviderHealthRows(rows);
  const yahooCommodity = summaries.find(row => row.provider === "Yahoo" && row.assetClass === "commodity");
  const stooqIndex = summaries.find(row => row.provider === "Stooq" && row.assetClass === "index");

  assert.ok(yahooCommodity);
  assert.ok(stooqIndex);
  assert.equal(yahooCommodity?.successes, 2);
  assert.equal(yahooCommodity?.degradedResponses, 0);
  assert.equal(stooqIndex?.emptyBodyResponses, 1);
  assert.equal(stooqIndex?.degradedResponses, 2);
  assert.ok((yahooCommodity?.recentScore ?? 0) > (stooqIndex?.recentScore ?? 100));
});
