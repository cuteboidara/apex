import assert from "node:assert/strict";
import test from "node:test";

test("stocks payload reports broken provider state instead of silent empty success", async () => {
  const globalForTest = globalThis as typeof globalThis & {
    __apexStocksRuntime?: {
      latestCards: unknown[];
      lastCycleAt: number | null;
      cycleRunning: boolean;
    };
    __apexStocksEngineState?: {
      lastKnownCandles: Map<string, unknown>;
      providerSummary: { status: "healthy" | "degraded" | "broken" | "no_data"; notice: string | null };
    };
  };

  globalForTest.__apexStocksEngineState = {
    lastKnownCandles: new Map(),
    providerSummary: {
      status: "broken",
      notice: "Stock publication is blocked because Yahoo Finance did not return trustworthy price or candle data.",
    },
  };
  globalForTest.__apexStocksRuntime = {
    latestCards: [{
      id: "stock-aapl-cycle",
      symbol: "AAPL",
      marketSymbol: "AAPL",
      displayName: "AAPL",
      category: "US_LARGE_CAP",
      livePrice: null,
      direction: "neutral",
      grade: "F",
      status: "blocked",
      marketOpen: false,
      noTradeReason: "null stock price",
      marketStateLabels: ["US Large Cap", "Market Closed", "NO DATA"],
      trendDirection: "neutral",
      daysUntilEarnings: null,
      dataSource: "none",
      displayCategory: "rejected",
    }],
    lastCycleAt: Date.now(),
    cycleRunning: false,
  };

  const { getStocksSignalsPayload } = await import("@/src/assets/stocks/engine/stocksRuntime");
  const payload = getStocksSignalsPayload();

  assert.equal(payload.providerName, "Yahoo");
  assert.equal(payload.providerStatus, "broken");
  assert.equal(payload.providerNotice, "Stock publication is blocked because Yahoo Finance did not return trustworthy price or candle data.");
  assert.ok(payload.liveMarketBoard.some(row => row.symbol === "AAPL" && row.dataSource === "none"));
});
