import assert from "node:assert/strict";
import test from "node:test";

import { CRYPTO_ACTIVE_SYMBOLS, CRYPTO_PAIR_PROFILES, getCryptoVolatilityWindow } from "@/src/crypto/config/cryptoScope";
import { fromBinanceSymbol, toBinanceSymbol } from "@/src/crypto/data/binanceSymbols";
import { getCryptoRuntimeStatus, getCryptoSignalsPayload, resetCryptoRuntimeForTests } from "@/src/crypto/engine/cryptoRuntime";

test("crypto scope stays limited to the four supported Binance USD pairs", () => {
  assert.deepEqual(CRYPTO_ACTIVE_SYMBOLS, ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]);
  assert.equal(getCryptoVolatilityWindow(0), "asian_open");
  assert.equal(getCryptoVolatilityWindow(8), "london_cross");
  assert.equal(getCryptoVolatilityWindow(14), "ny_open");
  assert.equal(getCryptoVolatilityWindow(21), "late_us");
  assert.equal(getCryptoVolatilityWindow(5), "low_volume");
});

test("Binance symbol helpers only accept the active crypto universe", () => {
  assert.equal(toBinanceSymbol("BTCUSDT"), "BTCUSDT");
  assert.equal(fromBinanceSymbol("ETHUSDT"), "ETHUSDT");
  assert.equal(fromBinanceSymbol("DOGEUSDT"), null);
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
