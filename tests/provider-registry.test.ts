import assert from "node:assert/strict";
import test from "node:test";

import { getProviderAdaptersForAsset } from "@/lib/marketData/providerRegistry";

test("crypto provider registry prioritizes Binance", () => {
  const providers = getProviderAdaptersForAsset("CRYPTO");
  assert.equal(providers[0]?.provider, "Binance");
  assert.equal(providers.length, 1);
});

test("forex and commodity provider registries use Yahoo Finance only", () => {
  const forexProviders = getProviderAdaptersForAsset("FOREX", "1m");
  const commodityProviders = getProviderAdaptersForAsset("COMMODITY", "1m");

  assert.equal(forexProviders[0]?.provider, "Yahoo Finance");
  assert.equal(commodityProviders[0]?.provider, "Yahoo Finance");
  assert.equal(forexProviders.length, 1);
  assert.equal(commodityProviders.length, 1);
});
