import type { CryptoSymbol } from "@/src/crypto/config/cryptoScope";
import { CRYPTO_ACTIVE_SYMBOLS } from "@/src/crypto/config/cryptoScope";
import { fromBinanceSymbol } from "@/src/crypto/data/binanceSymbols";

type LivePriceEntry = {
  price: number;
  updatedAt: number;
};

type BinanceTickerMessage = {
  stream: string;
  data: {
    s: string;
    c: string;
  };
};

type CryptoWebSocketState = {
  livePrices: Map<CryptoSymbol, LivePriceEntry>;
  wsInstance: WebSocket | null;
  isConnecting: boolean;
  intentionalClose: boolean;
};

const globalForBinanceWs = globalThis as typeof globalThis & {
  __apexBinanceWsState?: CryptoWebSocketState;
};

const state = globalForBinanceWs.__apexBinanceWsState ??= {
  livePrices: new Map<CryptoSymbol, LivePriceEntry>(),
  wsInstance: null,
  isConnecting: false,
  intentionalClose: false,
};

const BINANCE_WS_BASE = "wss://stream.binance.com:9443/stream";

function buildStreamUrl(): string {
  const streams = CRYPTO_ACTIVE_SYMBOLS.map(symbol => `${symbol.toLowerCase()}@ticker`).join("/");
  return `${BINANCE_WS_BASE}?streams=${streams}`;
}

function readMessageData(event: MessageEvent): string | null {
  if (typeof event.data === "string") {
    return event.data;
  }

  if (event.data instanceof ArrayBuffer) {
    return new TextDecoder().decode(event.data);
  }

  if (ArrayBuffer.isView(event.data)) {
    return new TextDecoder().decode(event.data);
  }

  return null;
}

export function startBinanceWebSocket(): void {
  if (typeof globalThis.WebSocket === "undefined") {
    console.warn("[binance-ws] WebSocket is not available in this runtime");
    return;
  }

  if (state.isConnecting || state.wsInstance?.readyState === 1) {
    return;
  }

  state.intentionalClose = false;
  state.isConnecting = true;

  const ws = new globalThis.WebSocket(buildStreamUrl());
  state.wsInstance = ws;

  ws.onopen = () => {
    state.isConnecting = false;
    console.log("[binance-ws] Connected");
  };

  ws.onmessage = event => {
    try {
      const payload = readMessageData(event);
      if (!payload) {
        return;
      }

      const message = JSON.parse(payload) as BinanceTickerMessage;
      const symbol = fromBinanceSymbol(message.data.s);
      const price = Number(message.data.c);
      if (!symbol || !Number.isFinite(price)) {
        return;
      }

      state.livePrices.set(symbol, {
        price,
        updatedAt: Date.now(),
      });
    } catch {
      // Ignore malformed ticker frames and keep the stream alive.
    }
  };

  ws.onerror = () => {
    state.isConnecting = false;
    console.error("[binance-ws] WebSocket error");
  };

  ws.onclose = () => {
    state.isConnecting = false;
    state.wsInstance = null;
    if (state.intentionalClose) {
      state.intentionalClose = false;
      return;
    }

    console.log("[binance-ws] Closed");
  };
}

export function stopBinanceWebSocket(): void {
  if (state.wsInstance) {
    state.intentionalClose = true;
    state.wsInstance.close();
    state.wsInstance = null;
  }

  state.isConnecting = false;
}

export function getCryptoLivePrice(symbol: CryptoSymbol): number | null {
  const entry = state.livePrices.get(symbol);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.updatedAt > 30_000) {
    return null;
  }

  return entry.price;
}

export function getAllCryptoLivePrices(): Record<CryptoSymbol, number | null> {
  const prices = {} as Record<CryptoSymbol, number | null>;
  for (const symbol of CRYPTO_ACTIVE_SYMBOLS) {
    prices[symbol] = getCryptoLivePrice(symbol);
  }
  return prices;
}

export function isBinanceWsConnected(): boolean {
  return state.wsInstance?.readyState === 1;
}

export function resetBinanceWebSocketForTests(): void {
  stopBinanceWebSocket();
  state.livePrices.clear();
}
