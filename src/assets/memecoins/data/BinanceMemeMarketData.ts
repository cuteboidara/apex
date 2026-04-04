import type { MTFCandles } from "@/src/assets/shared/mtfAnalysis";
import type { Candle } from "@/src/smc/types";

const BINANCE_REST_BASE = "https://api.binance.com/api/v3";
const BINANCE_WS_BASE = "wss://stream.binance.com:9443/stream";
const CANDLE_CACHE_TTL_MS = 60_000;

type CachedCandles = {
  candles: Candle[];
  fetchedAt: number;
};

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

type MemeBinanceState = {
  candleCache: Map<string, CachedCandles>;
  livePrices: Map<string, LivePriceEntry>;
  wsInstance: WebSocket | null;
  isConnecting: boolean;
  intentionalClose: boolean;
  subscribedSymbolsKey: string;
};

const globalForMemeBinance = globalThis as typeof globalThis & {
  __apexMemeBinanceState?: MemeBinanceState;
};

const state = globalForMemeBinance.__apexMemeBinanceState ??= {
  candleCache: new Map<string, CachedCandles>(),
  livePrices: new Map<string, LivePriceEntry>(),
  wsInstance: null,
  isConnecting: false,
  intentionalClose: false,
  subscribedSymbolsKey: "",
};

function buildStreamUrl(symbols: string[]): string {
  const streams = symbols.map(symbol => `${symbol.toLowerCase()}@ticker`).join("/");
  return `${BINANCE_WS_BASE}?streams=${streams}`;
}

function aggregateCandles(candles: Candle[], bucketMs: number): Candle[] {
  if (candles.length === 0) {
    return [];
  }

  const grouped = new Map<number, Candle[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.time * 1000 / bucketMs) * bucketMs;
    if (!grouped.has(bucket)) {
      grouped.set(bucket, []);
    }
    grouped.get(bucket)?.push(candle);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucket, group]) => ({
      time: Math.floor(bucket / 1000),
      open: group[0]?.open ?? group[0]?.close ?? 0,
      high: Math.max(...group.map(candle => candle.high)),
      low: Math.min(...group.map(candle => candle.low)),
      close: group.at(-1)?.close ?? group[0]?.close ?? 0,
      volume: group.reduce((sum, candle) => sum + (candle.volume ?? 0), 0),
    }))
    .filter(candle => candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0);
}

function normalizeTime(candles: Candle[]): Candle[] {
  return candles.map(candle => ({
    ...candle,
    time: candle.time * 1000,
  }));
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

function connectWebSocket(symbols: string[]): void {
  if (typeof globalThis.WebSocket === "undefined" || symbols.length === 0) {
    return;
  }

  state.intentionalClose = false;
  state.isConnecting = true;
  state.subscribedSymbolsKey = symbols.join(",");

  const ws = new globalThis.WebSocket(buildStreamUrl(symbols));
  state.wsInstance = ws;

  ws.onopen = () => {
    state.isConnecting = false;
    console.log(`[meme-binance-ws] Connected for ${symbols.length} symbols`);
  };

  ws.onmessage = event => {
    try {
      const payload = readMessageData(event);
      if (!payload) {
        return;
      }

      const message = JSON.parse(payload) as BinanceTickerMessage;
      const price = Number(message.data.c);
      if (!Number.isFinite(price)) {
        return;
      }

      state.livePrices.set(message.data.s, {
        price,
        updatedAt: Date.now(),
      });
    } catch {
      // Ignore malformed frames and keep the stream alive.
    }
  };

  ws.onerror = () => {
    state.isConnecting = false;
    console.error("[meme-binance-ws] WebSocket error");
  };

  ws.onclose = () => {
    state.isConnecting = false;
    state.wsInstance = null;
    if (state.intentionalClose) {
      state.intentionalClose = false;
      return;
    }
  };
}

function closeCurrentSocket(): void {
  if (state.wsInstance) {
    state.intentionalClose = true;
    state.wsInstance.close();
    state.wsInstance = null;
  }

  state.isConnecting = false;
}

export function ensureMemeBinanceWebSocket(symbols: string[]): void {
  const uniqueSymbols = [...new Set(symbols.filter(Boolean))].sort();
  const nextKey = uniqueSymbols.join(",");

  if (uniqueSymbols.length === 0 || typeof globalThis.WebSocket === "undefined") {
    return;
  }

  if (state.subscribedSymbolsKey !== nextKey && state.wsInstance) {
    closeCurrentSocket();
  }

  if (
    state.subscribedSymbolsKey === nextKey
    && (state.isConnecting || state.wsInstance?.readyState === 1)
  ) {
    return;
  }

  connectWebSocket(uniqueSymbols);
}

export async function fetchMemeBinanceCandles(symbol: string): Promise<Candle[]> {
  return fetchMemeBinanceCandlesByInterval(symbol, "15m", 100);
}

export async function fetchMemeBinanceCandlesByInterval(
  symbol: string,
  interval: "5m" | "15m" | "1h" | "4h" | "1d",
  limit = 100,
): Promise<Candle[]> {
  const cacheKey = `${symbol}:${interval}:${limit}`;
  const cached = state.candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CANDLE_CACHE_TTL_MS) {
    return cached.candles;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(`${BINANCE_REST_BASE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      throw new Error(`Binance candle fetch failed: ${response.status} for ${symbol}`);
    }

    const raw = await response.json() as unknown[][];
    const candles = raw.map(candle => ({
      time: Math.floor(Number(candle[0]) / 1000),
      open: Number(candle[1]),
      high: Number(candle[2]),
      low: Number(candle[3]),
      close: Number(candle[4]),
      volume: Number(candle[5]),
    }));

    state.candleCache.set(cacheKey, {
      candles,
      fetchedAt: Date.now(),
    });
    return candles;
  } catch (error) {
    console.error(`[meme-binance] Failed to fetch candles for ${symbol} ${interval}:`, error);
    return state.candleCache.get(cacheKey)?.candles ?? [];
  }
}

export async function fetchMemeBinanceTickerPrice(symbol: string): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(`${BINANCE_REST_BASE}/ticker/price?symbol=${symbol}`, {
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timeout);
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { price: string };
    return Number(data.price);
  } catch {
    return null;
  }
}

export async function fetchMemeBinanceLivePrice(symbol: string): Promise<number | null> {
  const wsPrice = getMemeBinanceLivePrice(symbol);
  if (wsPrice != null) {
    return wsPrice;
  }

  return fetchMemeBinanceTickerPrice(symbol);
}

export async function fetchMemeBinanceMtfcandles(symbol: string): Promise<MTFCandles> {
  const [dailyRaw, h4Raw, h1Raw, m15Raw, m5Raw] = await Promise.all([
    fetchMemeBinanceCandlesByInterval(symbol, "1d", 180),
    fetchMemeBinanceCandlesByInterval(symbol, "4h", 180),
    fetchMemeBinanceCandlesByInterval(symbol, "1h", 240),
    fetchMemeBinanceCandlesByInterval(symbol, "15m", 240),
    fetchMemeBinanceCandlesByInterval(symbol, "5m", 240),
  ]);

  const daily = normalizeTime(dailyRaw);
  const h4 = normalizeTime(h4Raw);
  const h1 = normalizeTime(h1Raw);
  const m15 = normalizeTime(m15Raw);
  const m5 = normalizeTime(m5Raw);

  return {
    monthly: aggregateCandles(daily, 30 * 24 * 60 * 60 * 1000),
    weekly: aggregateCandles(daily, 7 * 24 * 60 * 60 * 1000),
    daily,
    h4,
    h1,
    m15,
    m5,
  };
}

export function getMemeBinanceLivePrice(symbol: string): number | null {
  const entry = state.livePrices.get(symbol);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.updatedAt > 30_000) {
    return null;
  }
  return entry.price;
}

export function isMemeBinanceWsConnected(): boolean {
  return state.wsInstance?.readyState === 1;
}

export function resetMemeBinanceMarketDataForTests(): void {
  closeCurrentSocket();
  state.candleCache.clear();
  state.livePrices.clear();
  state.subscribedSymbolsKey = "";
}
