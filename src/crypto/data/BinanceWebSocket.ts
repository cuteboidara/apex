import NodeWebSocket from "ws";

import { CRYPTO_ACTIVE_SYMBOLS, type CryptoSymbol } from "@/src/crypto/config/cryptoScope";
import { fromBinanceSymbol, toBinanceSymbol } from "@/src/crypto/data/binanceSymbols";

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

type WebSocketLike = {
  readyState: number;
  close: () => void;
  onopen: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
};

type WebSocketConstructor = new (url: string) => WebSocketLike;

type CryptoWebSocketState = {
  livePrices: Map<CryptoSymbol, LivePriceEntry>;
  wsInstance: WebSocketLike | null;
  isConnecting: boolean;
  intentionalClose: boolean;
  subscribedSymbolsKey: string;
  subscribedSymbols: CryptoSymbol[];
};

const globalForBinanceWs = globalThis as typeof globalThis & {
  __apexBinanceWsState?: CryptoWebSocketState;
};

const state = globalForBinanceWs.__apexBinanceWsState ??= {
  livePrices: new Map<CryptoSymbol, LivePriceEntry>(),
  wsInstance: null,
  isConnecting: false,
  intentionalClose: false,
  subscribedSymbolsKey: "",
  subscribedSymbols: [...CRYPTO_ACTIVE_SYMBOLS],
};

const BINANCE_WS_BASE = "wss://stream.binance.com:9443/stream";

function normalizeSymbols(symbols?: string[]): CryptoSymbol[] {
  const next = [...new Set((symbols ?? [...CRYPTO_ACTIVE_SYMBOLS]).map(symbol => toBinanceSymbol(symbol)).filter(Boolean))];
  return next.length > 0 ? next : [...CRYPTO_ACTIVE_SYMBOLS];
}

function buildStreamUrl(symbols: CryptoSymbol[]): string {
  const streams = symbols.map(symbol => `${symbol.toLowerCase()}@ticker`).join("/");
  return `${BINANCE_WS_BASE}?streams=${streams}`;
}

function readMessageData(event: { data: unknown }): string | null {
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function resolveWebSocketConstructor(): WebSocketConstructor {
  return (globalThis.WebSocket ?? NodeWebSocket) as unknown as WebSocketConstructor;
}

function closeCurrentSocket(): void {
  if (state.wsInstance) {
    state.intentionalClose = true;
    state.wsInstance.close();
    state.wsInstance = null;
  }

  state.isConnecting = false;
}

export function startBinanceWebSocket(symbols?: string[]): void {
  const normalizedSymbols = normalizeSymbols(symbols);
  const nextKey = normalizedSymbols.join(",");

  if (state.subscribedSymbolsKey !== nextKey && state.wsInstance) {
    closeCurrentSocket();
  }

  if (
    state.subscribedSymbolsKey === nextKey
    && (state.isConnecting || state.wsInstance?.readyState === 1)
  ) {
    return;
  }

  state.intentionalClose = false;
  state.isConnecting = true;
  state.subscribedSymbols = normalizedSymbols;
  state.subscribedSymbolsKey = nextKey;

  const WebSocketImpl = resolveWebSocketConstructor();
  const ws = new WebSocketImpl(buildStreamUrl(normalizedSymbols));
  state.wsInstance = ws;

  ws.onopen = () => {
    state.isConnecting = false;
    console.log(`[binance-ws] Connected for ${normalizedSymbols.length} symbols`);
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
  closeCurrentSocket();
}

export function getCryptoLivePrice(symbol: CryptoSymbol): number | null {
  const entry = state.livePrices.get(toBinanceSymbol(symbol));
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.updatedAt > 30_000) {
    return null;
  }

  return entry.price;
}

export function getAllCryptoLivePrices(symbols?: string[]): Record<string, number | null> {
  const selectedSymbols = normalizeSymbols(symbols ?? state.subscribedSymbols);
  const prices: Record<string, number | null> = {};
  for (const symbol of selectedSymbols) {
    prices[symbol] = getCryptoLivePrice(symbol);
  }
  return prices;
}

export function isBinanceWsConnected(): boolean {
  return state.wsInstance?.readyState === 1;
}

export async function waitForBinanceWebSocket(timeoutMs = 1_500, symbols?: string[]): Promise<boolean> {
  startBinanceWebSocket(symbols);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (isBinanceWsConnected()) {
      return true;
    }
    await sleep(100);
  }

  return isBinanceWsConnected();
}

export function getBinanceSubscribedSymbols(): CryptoSymbol[] {
  return [...state.subscribedSymbols];
}

export function resetBinanceWebSocketForTests(): void {
  stopBinanceWebSocket();
  state.livePrices.clear();
  state.subscribedSymbols = [...CRYPTO_ACTIVE_SYMBOLS];
  state.subscribedSymbolsKey = "";
}
