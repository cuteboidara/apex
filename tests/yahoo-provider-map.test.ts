import assert from "node:assert/strict";
import test from "node:test";

import { YAHOO_SYMBOL_MAP } from "@/lib/providers/yahooFinance";

test("shared Yahoo provider map covers active FX and Yahoo-backed commodity symbols", () => {
  const expectedMappings = {
    EURUSD: "EURUSD=X",
    GBPUSD: "GBPUSD=X",
    USDJPY: "USDJPY=X",
    EURJPY: "EURJPY=X",
    AUDUSD: "AUDUSD=X",
    NZDUSD: "NZDUSD=X",
    USDCHF: "CHF=X",
    USDCAD: "CAD=X",
    XAUUSD: "GC=F",
    XAGUSD: "SI=F",
    WTICOUSD: "CL=F",
    BCOUSD: "BZ=F",
    NATGASUSD: "NG=F",
  } as const;

  for (const [symbol, yahooSymbol] of Object.entries(expectedMappings)) {
    assert.equal(
      YAHOO_SYMBOL_MAP[symbol],
      yahooSymbol,
      `Expected Yahoo mapping for ${symbol}`,
    );
  }
});
