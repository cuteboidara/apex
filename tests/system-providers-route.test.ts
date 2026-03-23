import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "@/app/api/system/providers/route";

test("system providers route exposes the active price providers", async () => {
  const response = await GET();
  const payload = await response.json() as { providers: Array<{ provider: string }> };

  assert.ok(payload.providers.some(provider => provider.provider === "Yahoo Finance"));
  assert.ok(payload.providers.some(provider => provider.provider === "Binance"));
});
