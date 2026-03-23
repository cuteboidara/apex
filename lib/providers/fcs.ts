import { recordProviderHealth } from "@/lib/providerHealth";
import type { AssetClass, CandleBar, Timeframe } from "@/lib/marketData/types";

const FCS_BASE = "https://api-v4.fcsapi.com";
const REQUEST_TIMEOUT_MS = 8000;
const FCS_QUOTE_PERIOD = "1D";
const FCS_HISTORY_LENGTH = 50;

type ProviderStatus = "LIVE" | "DEGRADED" | "UNAVAILABLE";

type FcsLatestPoint = {
  a?: number | string;
  b?: number | string;
  o?: number | string;
  h?: number | string;
  l?: number | string;
  c?: number | string;
  v?: number | string | null;
  t?: number | string;
  tm?: string;
  ch?: number | string;
  chp?: number | string;
};

type FcsLatestEnvelope = {
  status?: boolean;
  code?: number | string;
  msg?: string;
  response?: Array<{
    ticker?: string;
    update?: number | string;
    datetime?: string;
    active?: FcsLatestPoint;
    previous?: FcsLatestPoint;
  }>;
};

type FcsHistoryPoint = {
  o?: number | string;
  h?: number | string;
  l?: number | string;
  c?: number | string;
  v?: number | string | null;
  t?: number | string;
  tm?: string;
};

type FcsHistoryEnvelope = {
  status?: boolean;
  code?: number | string;
  msg?: string;
  response?: Record<string, FcsHistoryPoint>;
};

type FcsSymbolConfig = {
  assetClass: AssetClass;
  latestPath: "/forex/latest" | "/crypto/latest";
  historyPath: "/forex/history" | "/crypto/history";
  latestSymbol: string;
  historySymbol: string;
  websocketSymbol: string;
  commodityType?: "commodity";
};

export type FcsNormalizedQuote = {
  symbol: string;
  provider: "FCS API";
  price: number | null;
  timestamp: number | null;
  change24h: number | null;
  high14d: number | null;
  low14d: number | null;
  volume: number | null;
  stale: boolean;
  marketStatus: ProviderStatus;
  reason: string | null;
};

export type FcsNormalizedCandles = {
  symbol: string;
  provider: "FCS API";
  timeframe: Timeframe;
  candles: CandleBar[];
  timestamp: number | null;
  stale: boolean;
  marketStatus: ProviderStatus;
  reason: string | null;
};

export const FCS_SYMBOL_MAP: Record<string, FcsSymbolConfig> = {
  EURUSD: {
    assetClass: "FOREX",
    latestPath: "/forex/latest",
    historyPath: "/forex/history",
    latestSymbol: "EURUSD",
    historySymbol: "EURUSD",
    websocketSymbol: "FX:EURUSD",
  },
  GBPUSD: {
    assetClass: "FOREX",
    latestPath: "/forex/latest",
    historyPath: "/forex/history",
    latestSymbol: "GBPUSD",
    historySymbol: "GBPUSD",
    websocketSymbol: "FX:GBPUSD",
  },
  USDJPY: {
    assetClass: "FOREX",
    latestPath: "/forex/latest",
    historyPath: "/forex/history",
    latestSymbol: "USDJPY",
    historySymbol: "USDJPY",
    websocketSymbol: "FX:USDJPY",
  },
  XAUUSD: {
    assetClass: "COMMODITY",
    latestPath: "/forex/latest",
    historyPath: "/forex/history",
    latestSymbol: "XAUUSD",
    historySymbol: "XAUUSD",
    websocketSymbol: "FX:XAUUSD",
    commodityType: "commodity",
  },
  XAGUSD: {
    assetClass: "COMMODITY",
    latestPath: "/forex/latest",
    historyPath: "/forex/history",
    latestSymbol: "XAGUSD",
    historySymbol: "XAGUSD",
    websocketSymbol: "FX:XAGUSD",
    commodityType: "commodity",
  },
  BTCUSDT: {
    assetClass: "CRYPTO",
    latestPath: "/crypto/latest",
    historyPath: "/crypto/history",
    latestSymbol: "BINANCE:BTCUSDT",
    historySymbol: "BINANCE:BTCUSDT",
    websocketSymbol: "BINANCE:BTCUSDT",
  },
  ETHUSDT: {
    assetClass: "CRYPTO",
    latestPath: "/crypto/latest",
    historyPath: "/crypto/history",
    latestSymbol: "BINANCE:ETHUSDT",
    historySymbol: "BINANCE:ETHUSDT",
    websocketSymbol: "BINANCE:ETHUSDT",
  },
};

function getFcsApiKey() {
  return process.env.FCS_API_KEY ?? "";
}

function toPositiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function toNullableNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toTimestampMs(value: unknown): number | null {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z");
  return Number.isFinite(parsed) ? parsed : null;
}

function unavailableQuote(symbol: string, reason: string): FcsNormalizedQuote {
  return {
    symbol,
    provider: "FCS API",
    price: null,
    timestamp: null,
    change24h: null,
    high14d: null,
    low14d: null,
    volume: null,
    stale: true,
    marketStatus: "UNAVAILABLE",
    reason,
  };
}

function unavailableCandles(symbol: string, timeframe: Timeframe, reason: string): FcsNormalizedCandles {
  return {
    symbol,
    provider: "FCS API",
    timeframe,
    candles: [],
    timestamp: null,
    stale: true,
    marketStatus: "UNAVAILABLE",
    reason,
  };
}

function getFcsSymbolConfig(symbol: string): FcsSymbolConfig | null {
  return FCS_SYMBOL_MAP[symbol] ?? null;
}

async function recordHealth(input: {
  requestSymbol: string;
  status: "OK" | "DEGRADED" | "ERROR";
  latencyMs: number;
  detail: string;
  errorRate: number;
}) {
  await recordProviderHealth({
    provider: "FCS API",
    requestSymbol: input.requestSymbol,
    status: input.status,
    latencyMs: input.latencyMs,
    detail: input.detail,
    errorRate: input.errorRate,
  });
}

async function fetchFcsJson<T>(
  path: string,
  params: Record<string, string>
): Promise<{ ok: boolean; status: number | null; data: T | null; detail: string }> {
  const apiKey = getFcsApiKey();
  if (!apiKey || apiKey === "PASTE_YOUR_KEY_HERE") {
    return { ok: false, status: null, data: null, detail: "missing_api_key" };
  }

  const url = new URL(path, FCS_BASE);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("access_key", apiKey);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    const rawText = await res.text();
    let data: T | null = null;

    try {
      data = rawText ? JSON.parse(rawText) as T : null;
    } catch {
      return { ok: false, status: res.status, data: null, detail: `non_json:${path}` };
    }

    if (!res.ok) {
      return { ok: false, status: res.status, data, detail: `http_${res.status}:${path}` };
    }

    return { ok: true, status: res.status, data, detail: path };
  } catch (error) {
    return {
      ok: false,
      status: null,
      data: null,
      detail: `exception:${String(error).slice(0, 160)}`,
    };
  }
}

function resolveEnvelopeError(payload: { status?: boolean; code?: number | string; msg?: string; response?: unknown } | null) {
  if (!payload) return "empty_payload";
  if (payload.status === false) return String(payload.msg ?? payload.code ?? "api_error");
  if (payload.response == null) return String(payload.msg ?? "missing_response");
  return null;
}

export async function getFcsQuote(symbol: string): Promise<FcsNormalizedQuote> {
  const config = getFcsSymbolConfig(symbol);
  if (!config) {
    return unavailableQuote(symbol, "FCS symbol mapping unavailable.");
  }
  // Yahoo Finance is the sole provider for FOREX and COMMODITY — never call FCS for those.
  if (config.assetClass === "FOREX" || config.assetClass === "COMMODITY") {
    return unavailableQuote(symbol, "FCS not used for FOREX/COMMODITY — Yahoo Finance handles these.");
  }

  const startedAt = Date.now();
  const response = await fetchFcsJson<FcsLatestEnvelope>(
    config.latestPath,
    {
      symbol: config.latestSymbol,
      period: FCS_QUOTE_PERIOD,
      ...(config.commodityType ? { type: config.commodityType } : {}),
    },
  );

  if (!response.ok) {
    await recordHealth({
      requestSymbol: symbol,
      status: response.detail === "missing_api_key" ? "ERROR" : "DEGRADED",
      latencyMs: Date.now() - startedAt,
      detail: response.detail,
      errorRate: 1,
    });
    return unavailableQuote(symbol, "FCS latest quote unavailable.");
  }

  const payload = response.data;
  const envelopeError = resolveEnvelopeError(payload ?? null);
  if (envelopeError) {
    await recordHealth({
      requestSymbol: symbol,
      status: "DEGRADED",
      latencyMs: Date.now() - startedAt,
      detail: `latest:${String(envelopeError).slice(0, 200)}`,
      errorRate: 1,
    });
    return unavailableQuote(symbol, String(envelopeError));
  }

  const row = Array.isArray(payload?.response) ? payload.response[0] : null;
  const active = row?.active;
  const price = toPositiveNumber(active?.c);
  const timestamp = toTimestampMs(row?.update ?? active?.t ?? row?.datetime ?? active?.tm);

  if (price == null) {
    await recordHealth({
      requestSymbol: symbol,
      status: "DEGRADED",
      latencyMs: Date.now() - startedAt,
      detail: "latest:parse_failure:price",
      errorRate: 1,
    });
    return unavailableQuote(symbol, "FCS latest quote contained no usable price.");
  }

  if (timestamp == null) {
    await recordHealth({
      requestSymbol: symbol,
      status: "DEGRADED",
      latencyMs: Date.now() - startedAt,
      detail: "latest:parse_failure:timestamp",
      errorRate: 1,
    });
    return {
      symbol,
      provider: "FCS API",
      price,
      timestamp: null,
      change24h: toNullableNumber(active?.chp),
      high14d: null,
      low14d: null,
      volume: toNullableNumber(active?.v),
      stale: true,
      marketStatus: "DEGRADED",
      reason: "FCS latest quote contained no usable timestamp.",
    };
  }

  await recordHealth({
    requestSymbol: symbol,
    status: "OK",
    latencyMs: Date.now() - startedAt,
    detail: `latest_ok:${config.latestSymbol}`,
    errorRate: 0,
  });

  return {
    symbol,
    provider: "FCS API",
    price,
    timestamp,
    change24h: toNullableNumber(active?.chp),
    high14d: null,
    low14d: null,
    volume: toNullableNumber(active?.v),
    stale: false,
    marketStatus: "LIVE",
    reason: null,
  };
}

function timeframeToFcsPeriod(timeframe: Timeframe) {
  const periodMap: Record<Timeframe, string> = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1h",
    "4h": "4h",
    "1D": "1D",
  };

  return periodMap[timeframe];
}

export async function getFcsCandles(symbol: string, timeframe: Timeframe): Promise<FcsNormalizedCandles> {
  const config = getFcsSymbolConfig(symbol);
  if (!config) {
    return unavailableCandles(symbol, timeframe, "FCS symbol mapping unavailable.");
  }
  // Yahoo Finance is the sole provider for FOREX and COMMODITY — never call FCS for those.
  if (config.assetClass === "FOREX" || config.assetClass === "COMMODITY") {
    return unavailableCandles(symbol, timeframe, "FCS not used for FOREX/COMMODITY — Yahoo Finance handles these.");
  }

  const startedAt = Date.now();
  const response = await fetchFcsJson<FcsHistoryEnvelope>(
    config.historyPath,
    {
      symbol: config.historySymbol,
      period: timeframeToFcsPeriod(timeframe),
      length: String(FCS_HISTORY_LENGTH),
      ...(config.commodityType ? { type: config.commodityType } : {}),
    },
  );

  if (!response.ok) {
    await recordHealth({
      requestSymbol: symbol,
      status: response.detail === "missing_api_key" ? "ERROR" : "DEGRADED",
      latencyMs: Date.now() - startedAt,
      detail: response.detail,
      errorRate: 1,
    });
    return unavailableCandles(symbol, timeframe, "FCS history unavailable.");
  }

  const payload = response.data;
  const envelopeError = resolveEnvelopeError(payload ?? null);
  if (envelopeError) {
    await recordHealth({
      requestSymbol: symbol,
      status: "DEGRADED",
      latencyMs: Date.now() - startedAt,
      detail: `history:${timeframe}:${String(envelopeError).slice(0, 200)}`,
      errorRate: 1,
    });
    return unavailableCandles(symbol, timeframe, String(envelopeError));
  }

  const rawRows = Object.values(payload?.response ?? {});
  const candles = rawRows
    .map(point => ({
      timestamp: toTimestampMs(point.t ?? point.tm),
      open: toNullableNumber(point.o),
      high: toNullableNumber(point.h),
      low: toNullableNumber(point.l),
      close: toNullableNumber(point.c),
      volume: toNullableNumber(point.v),
    }))
    .filter((point): point is CandleBar => point.timestamp != null)
    .sort((left, right) => left.timestamp - right.timestamp);

  if (candles.length === 0) {
    await recordHealth({
      requestSymbol: symbol,
      status: "DEGRADED",
      latencyMs: Date.now() - startedAt,
      detail: `history:${timeframe}:empty_candles`,
      errorRate: 1,
    });
    return unavailableCandles(symbol, timeframe, "FCS returned no candle data.");
  }

  if (candles.at(-1)?.timestamp == null) {
    await recordHealth({
      requestSymbol: symbol,
      status: "DEGRADED",
      latencyMs: Date.now() - startedAt,
      detail: `history:${timeframe}:missing_timestamp`,
      errorRate: 1,
    });
    return unavailableCandles(symbol, timeframe, "FCS candle response contained no usable timestamps.");
  }

  await recordHealth({
    requestSymbol: symbol,
    status: "OK",
    latencyMs: Date.now() - startedAt,
    detail: `history_ok:${timeframe}:${config.historySymbol}`,
    errorRate: 0,
  });

  return {
    symbol,
    provider: "FCS API",
    timeframe,
    candles,
    timestamp: candles.at(-1)?.timestamp ?? null,
    stale: false,
    marketStatus: "LIVE",
    reason: null,
  };
}
