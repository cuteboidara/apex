import assert from "node:assert/strict";
import test from "node:test";

import { classifyFreshness, getCandleStalenessWindowMs, getQuoteStalenessWindowMs } from "@/lib/marketData/staleness";

test("quote staleness windows are tighter for crypto than swing candles", () => {
  assert.ok(getQuoteStalenessWindowMs("CRYPTO") < getCandleStalenessWindowMs("1D"));
});

test("freshness classification returns fresh, stale, and expired bands", () => {
  const now = Date.now();
  const fresh = classifyFreshness(now - 5_000, 30_000);
  const stale = classifyFreshness(now - 45_000, 30_000);
  const expired = classifyFreshness(now - 200_000, 30_000);

  assert.equal(fresh.freshnessClass, "fresh");
  assert.equal(stale.freshnessClass, "stale");
  assert.equal(expired.freshnessClass, "expired");
});
