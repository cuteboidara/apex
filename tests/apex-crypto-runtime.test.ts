import assert from "node:assert/strict";
import test from "node:test";

import { fetchMemeBinanceLivePrice, fetchMemeBinanceMtfcandles, resetMemeBinanceMarketDataForTests } from "@/src/assets/memecoins/data/BinanceMemeMarketData";
import { fetchMTFCandles } from "@/src/assets/shared/mtfDataFetcher";
import { CRYPTO_ACTIVE_SYMBOLS, CRYPTO_PAIR_PROFILES, getCryptoVolatilityWindow } from "@/src/crypto/config/cryptoScope";
import { fromBinanceSymbol, toBinanceSymbol } from "@/src/crypto/data/binanceSymbols";
import { selectTradableAssets } from "@/src/crypto/engine/CryptoEngine";
import { getCryptoRuntimeStatus, getCryptoSignalsPayload, resetCryptoRuntimeForTests } from "@/src/crypto/engine/cryptoRuntime";

function intervalMs(interval: string): number {
  if (interval === "1d") return 24 * 60 * 60 * 1000;
  if (interval === "4h") return 4 * 60 * 60 * 1000;
  if (interval === "1h") return 60 * 60 * 1000;
  if (interval === "15m") return 15 * 60 * 1000;
  if (interval === "5m") return 5 * 60 * 1000;
  throw new Error(`Unsupported interval ${interval}`);
}

function buildKlines(interval: string, count: number): unknown[][] {
  const step = intervalMs(interval);
  const baseTime = Date.UTC(2026, 3, 1, 0, 0, 0);

  return Array.from({ length: count }, (_, index) => {
    const open = 100 + (index * 0.25);
    return [
      baseTime + (index * step),
      open.toFixed(2),
      (open + 1).toFixed(2),
      (open - 1).toFixed(2),
      (open + 0.4).toFixed(2),
      (1_000 + index).toFixed(2),
    ];
  });
}

test("crypto scope stays limited to the four supported Binance USD pairs", () => {
  assert.deepEqual(CRYPTO_ACTIVE_SYMBOLS, ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]);
  assert.equal(getCryptoVolatilityWindow(0), "asian_open");
  assert.equal(getCryptoVolatilityWindow(8), "london_cross");
  assert.equal(getCryptoVolatilityWindow(14), "ny_open");
  assert.equal(getCryptoVolatilityWindow(21), "late_us");
  assert.equal(getCryptoVolatilityWindow(5), "low_volume");
});

test("Binance symbol helpers normalize Binance USDT symbols for the dynamic crypto universe", () => {
  assert.equal(toBinanceSymbol("BTCUSDT"), "BTCUSDT");
  assert.equal(fromBinanceSymbol("ETHUSDT"), "ETHUSDT");
  assert.equal(fromBinanceSymbol("DOGEUSDT"), "DOGEUSDT");
  assert.equal(fromBinanceSymbol("BTCUSD"), null);
});

test("crypto runtime exposes a safe empty payload before the first cycle", () => {
  resetCryptoRuntimeForTests();

  const payload = getCryptoSignalsPayload();
  const status = getCryptoRuntimeStatus();

  assert.equal(status.cardCount, 0);
  assert.equal(status.cycleRunning, false);
  assert.equal(payload.cards.length, 0);
  assert.equal(payload.executable.length, 0);
  assert.equal(payload.liveMarketBoard.length, 4);
  assert.deepEqual(payload.liveMarketBoard.map(row => row.symbol), [...CRYPTO_ACTIVE_SYMBOLS]);
});

test("crypto profiles expose 24/7 session coverage for the main BTC and ETH pairs", () => {
  assert.deepEqual(CRYPTO_PAIR_PROFILES.BTCUSDT.allowedSessions, ["asia", "london", "new_york", "off_hours"]);
  assert.deepEqual(CRYPTO_PAIR_PROFILES.ETHUSDT.allowedSessions, ["asia", "london", "new_york", "off_hours"]);
});

test("crypto payload access starts the Binance websocket when the runtime supports it", () => {
  resetCryptoRuntimeForTests();

  const originalWebSocket = globalThis.WebSocket;
  let createdSockets = 0;

  class FakeWebSocket {
    static readonly OPEN = 1;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onclose: (() => void) | null = null;

    constructor(_url: string) {
      createdSockets += 1;
    }

    close() {
      this.readyState = 3;
      this.onclose?.();
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;

  try {
    getCryptoSignalsPayload();
    const status = getCryptoRuntimeStatus();
    assert.equal(createdSockets, 1);
    assert.equal(status.wsConnected, true);
  } finally {
    resetCryptoRuntimeForTests();
    globalThis.WebSocket = originalWebSocket;
  }
});

test("crypto MTF fetching uses Binance REST klines for serverless-safe inputs", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);
    const parsed = new URL(url);
    const interval = parsed.searchParams.get("interval");

    if (parsed.hostname !== "api.binance.com" || interval == null) {
      throw new Error(`Unexpected fetch ${url}`);
    }

    const count = interval === "1d" ? 180 : 240;
    return new Response(JSON.stringify(buildKlines(interval, count)), { status: 200 });
  }) as typeof fetch;

  try {
    const mtf = await fetchMTFCandles("BTCUSDT");

    assert.equal(requestedUrls.length, 5);
    assert.equal(requestedUrls.every(url => url.includes("api.binance.com/api/v3/klines")), true);
    assert.equal(mtf.daily.length, 180);
    assert.equal(mtf.h4.length, 240);
    assert.equal(mtf.h1.length, 240);
    assert.equal(mtf.m15.length, 240);
    assert.equal(mtf.m5.length, 240);
    assert.ok(mtf.weekly.length >= 8);
    assert.ok(mtf.monthly.length >= 4);
    assert.ok(mtf.h1[0]!.time > 1_000_000_000_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("crypto selection falls back to Bybit when Binance 24hr is geo-blocked", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);

    if (url.includes("api.binance.com/api/v3/ticker/24hr")) {
      return new Response(JSON.stringify({ code: 0, msg: "restricted" }), { status: 451 });
    }

    if (url.includes("api.bybit.com/v5/market/tickers?category=spot")) {
      const symbols = [
        "BTC",
        "ETH",
        "SOL",
        "BNB",
        "XRP",
        "DOGE",
        "ADA",
        "AVAX",
        "LINK",
        "DOT",
        "TON",
        "TRX",
        "LTC",
        "BCH",
        "NEAR",
        "APT",
        "ARB",
        "OP",
        "ATOM",
        "INJ",
        "SUI",
        "PEPE",
        "SHIB",
        "AAVE",
      ];

      return new Response(JSON.stringify({
        retCode: 0,
        result: {
          list: symbols.map((symbol, index) => ({
            symbol: `${symbol}USDT`,
            lastPrice: String(100 + index),
            price24hPcnt: String(0.02 + (index * 0.001)),
            turnover24h: String(300_000_000 - (index * 1_000_000)),
            highPrice24h: String(101 + index),
            lowPrice24h: String(99 + index),
          })),
        },
      }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const selection = await selectTradableAssets({ force: true, limit: 24 });

    assert.equal(selection.provider, "bybit_tickers");
    assert.equal(selection.assets.length, 24);
    assert.equal(selection.assets[0]?.symbol, "BTCUSDT");
    assert.ok(selection.assets.some(asset => asset.symbol === "DOGEUSDT"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("memecoin Binance helpers fall back to REST when no websocket price buffer exists", async () => {
  resetMemeBinanceMarketDataForTests();
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);
    const parsed = new URL(url);

    if (parsed.pathname.endsWith("/ticker/price")) {
      return new Response(JSON.stringify({ price: "0.1234" }), { status: 200 });
    }

    const interval = parsed.searchParams.get("interval");
    if (parsed.pathname.endsWith("/klines") && interval != null) {
      const count = interval === "1d" || interval === "4h" ? 180 : 240;
      return new Response(JSON.stringify(buildKlines(interval, count)), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  }) as typeof fetch;

  try {
    const [livePrice, mtf] = await Promise.all([
      fetchMemeBinanceLivePrice("DOGEUSDT"),
      fetchMemeBinanceMtfcandles("DOGEUSDT"),
    ]);

    assert.equal(livePrice, 0.1234);
    assert.ok(requestedUrls.some(url => url.includes("/ticker/price?symbol=DOGEUSDT")));
    assert.equal(requestedUrls.filter(url => url.includes("/klines?symbol=DOGEUSDT")).length, 5);
    assert.equal(mtf.daily.length, 180);
    assert.equal(mtf.h4.length, 180);
    assert.equal(mtf.h1.length, 240);
    assert.equal(mtf.m15.length, 240);
    assert.equal(mtf.m5.length, 240);
    assert.ok(mtf.weekly.length >= 8);
    assert.ok(mtf.monthly.length >= 4);
  } finally {
    resetMemeBinanceMarketDataForTests();
    globalThis.fetch = originalFetch;
  }
});
