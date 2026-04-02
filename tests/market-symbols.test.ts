import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareSignalViewModelForPersistence,
  readPersistedMarketSymbol,
} from "@/src/assets/shared/persistedSignalViewModel";
import { canonicalizeMarketSymbol, expandMarketSymbolAliases } from "@/src/lib/marketSymbols";
import { resolveYahooSymbol } from "@/src/lib/yahooFinance";

test("market symbol canonicalizer normalizes metal aliases and pair casing", () => {
  assert.equal(canonicalizeMarketSymbol("GC=F"), "XAUUSD");
  assert.equal(canonicalizeMarketSymbol("gold"), "XAUUSD");
  assert.equal(canonicalizeMarketSymbol("SI=F"), "XAGUSD");
  assert.equal(canonicalizeMarketSymbol("silver"), "XAGUSD");
  assert.equal(canonicalizeMarketSymbol("eurusd"), "EURUSD");
});

test("market symbol alias expansion includes forex metal fallback aliases", () => {
  const expanded = expandMarketSymbolAliases(["EURUSD", "XAUUSD", "XAGUSD"]);

  assert.ok(expanded.includes("EURUSD"));
  assert.ok(expanded.includes("XAUUSD"));
  assert.ok(expanded.includes("GC=F"));
  assert.ok(expanded.includes("GOLD"));
  assert.ok(expanded.includes("XAU/USD"));
  assert.ok(expanded.includes("XAGUSD"));
  assert.ok(expanded.includes("SI=F"));
  assert.ok(expanded.includes("SILVER"));
  assert.ok(expanded.includes("XAG/USD"));
});

test("persisted signal helpers store and read silver aliases canonically", () => {
  const prepared = prepareSignalViewModelForPersistence({
    symbol: "SI=F",
    signal_id: null,
    ui_sections: {
      marketSymbol: "silver",
      refs: {},
      health: {},
    },
  } as any);

  assert.equal(prepared.symbol, "XAGUSD");
  assert.equal(readPersistedMarketSymbol(prepared.ui_sections), "XAGUSD");
  assert.equal((prepared.ui_sections.model as { symbol?: string }).symbol, "XAGUSD");
  assert.equal((prepared.ui_sections as { marketSymbol?: string }).marketSymbol, "XAGUSD");
});

test("Yahoo symbol resolution accepts metal aliases", () => {
  assert.equal(resolveYahooSymbol("GC=F"), "GC=F");
  assert.equal(resolveYahooSymbol("XAU/USD"), "GC=F");
  assert.equal(resolveYahooSymbol("SI=F"), "SI=F");
  assert.equal(resolveYahooSymbol("silver"), "SI=F");
});
