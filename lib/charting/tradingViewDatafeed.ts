import { normalizeTradingViewBars, tradingViewBarKey, type CandleApiResponse, type TradingViewBar } from "@/lib/charting/barNormalizer";
import { mapResolutionToTimeframe, TRADINGVIEW_RESOLUTIONS, type TradingViewResolution } from "@/lib/charting/resolutionMap";
import { getTradingViewSymbol, searchTradingViewSymbols, type TradingViewSymbolType } from "@/lib/charting/symbolMap";

type TradingViewDatafeedConfiguration = {
  supported_resolutions: readonly TradingViewResolution[];
  supports_search: boolean;
  supports_group_request: false;
  supports_marks: false;
  supports_timescale_marks: false;
  supports_time: true;
  exchanges: Array<{
    value: string;
    name: string;
    desc: string;
  }>;
  symbols_types: Array<{
    name: string;
    value: TradingViewSymbolType;
  }>;
};

export type TradingViewSymbolInfo = {
  name: string;
  ticker: string;
  description: string;
  type: TradingViewSymbolType;
  session: string;
  timezone: string;
  exchange: string;
  minmov: number;
  pricescale: number;
  has_intraday: true;
  has_daily: true;
  supported_resolutions: readonly TradingViewResolution[];
  data_status: "streaming";
  format: "price";
};

type SearchSymbolResult = {
  symbol: string;
  full_name: string;
  description: string;
  exchange: string;
  ticker: string;
  type: TradingViewSymbolType;
};

type SearchSymbolsCallback = (results: SearchSymbolResult[]) => void;
type HistoryCallback = (bars: TradingViewBar[], meta: { noData: boolean }) => void;
type ErrorCallback = (reason: string) => void;
type RealtimeCallback = (bar: TradingViewBar) => void;
type ResetCacheCallback = () => void;

type PeriodParams = {
  from: number;
  to: number;
  countBack?: number;
  firstDataRequest: boolean;
};

type SubscriptionState = {
  resolution: TradingViewResolution;
  symbolInfo: TradingViewSymbolInfo;
  lastBar: TradingViewBar | null;
  timer: ReturnType<typeof setInterval>;
};

export type TradingViewDatafeed = {
  onReady: (callback: (configuration: TradingViewDatafeedConfiguration) => void) => void;
  searchSymbols: (
    userInput: string,
    exchange: string,
    symbolType: string,
    onResultReadyCallback: SearchSymbolsCallback
  ) => void;
  resolveSymbol: (
    symbolName: string,
    onSymbolResolvedCallback: (symbolInfo: TradingViewSymbolInfo) => void,
    onResolveErrorCallback: ErrorCallback
  ) => void;
  getBars: (
    symbolInfo: TradingViewSymbolInfo,
    resolution: string,
    periodParams: PeriodParams,
    onHistoryCallback: HistoryCallback,
    onErrorCallback: ErrorCallback
  ) => Promise<void>;
  subscribeBars: (
    symbolInfo: TradingViewSymbolInfo,
    resolution: string,
    onRealtimeCallback: RealtimeCallback,
    subscriberUID: string,
    onResetCacheNeededCallback?: ResetCacheCallback
  ) => void;
  unsubscribeBars: (subscriberUID: string) => void;
};

export type CreateTradingViewDatafeedOptions = {
  apiBaseUrl?: string;
  pollIntervalMs?: number;
  candleLimit?: number;
  fetchImpl?: typeof fetch;
  logger?: Pick<Console, "debug" | "warn">;
};

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_CANDLE_LIMIT = 200;

const DATAFEED_CONFIGURATION: TradingViewDatafeedConfiguration = {
  supported_resolutions: TRADINGVIEW_RESOLUTIONS,
  supports_search: true,
  supports_group_request: false,
  supports_marks: false,
  supports_timescale_marks: false,
  supports_time: true,
  exchanges: [
    {
      value: "APEX",
      name: "APEX",
      desc: "Apex internal market data",
    },
  ],
  symbols_types: [
    { name: "Crypto", value: "crypto" },
    { name: "Forex", value: "forex" },
    { name: "Commodity", value: "commodity" },
  ],
};

function isDevelopment() {
  return process.env.NODE_ENV !== "production";
}

function buildApiUrl(
  path: string,
  params: Record<string, string | number | undefined>,
  apiBaseUrl?: string
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    query.set(key, String(value));
  }

  if (!apiBaseUrl) {
    const search = query.toString();
    return search ? `${path}?${search}` : path;
  }

  const normalizedBase = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = new URL(path.replace(/^\//, ""), normalizedBase);
  url.search = query.toString();
  return url.toString();
}

function toSymbolInfo(symbolName: string): TradingViewSymbolInfo | null {
  const symbol = getTradingViewSymbol(symbolName);
  if (!symbol) return null;

  return {
    name: symbol.symbol,
    ticker: symbol.symbol,
    description: symbol.description,
    type: symbol.type,
    session: symbol.session,
    timezone: symbol.timezone,
    exchange: symbol.exchange,
    minmov: symbol.minmov,
    pricescale: symbol.pricescale,
    has_intraday: true,
    has_daily: true,
    supported_resolutions: TRADINGVIEW_RESOLUTIONS,
    data_status: "streaming",
    format: "price",
  };
}

export function createTradingViewDatafeed(options: CreateTradingViewDatafeedOptions = {}): TradingViewDatafeed {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const logger = options.logger ?? console;
  const pollIntervalMs = Math.max(2_000, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const candleLimit = Math.min(200, Math.max(2, options.candleLimit ?? DEFAULT_CANDLE_LIMIT));
  const subscriptions = new Map<string, SubscriptionState>();

  async function requestCandles(symbol: string, resolution: string, params: { from?: number; to?: number; limit?: number }) {
    if (typeof fetchImpl !== "function") {
      throw new Error("Fetch is unavailable for TradingView datafeed requests.");
    }

    const timeframe = mapResolutionToTimeframe(resolution);
    if (!timeframe) {
      throw new Error(`Unsupported TradingView resolution: ${resolution}`);
    }

    const requestUrl = buildApiUrl("/api/market/candles", {
      symbol,
      timeframe,
      limit: Math.min(200, Math.max(2, params.limit ?? candleLimit)),
      from: params.from,
      to: params.to,
    }, options.apiBaseUrl);

    const response = await fetchImpl(requestUrl, { cache: "no-store" });
    const payload = await response.json().catch(() => null) as CandleApiResponse | { error?: string } | null;

    if (!response.ok) {
      throw new Error((payload as { error?: string } | null)?.error ?? `Candle request failed with ${response.status}`);
    }

    return payload as CandleApiResponse;
  }

  function logDegradedState(action: string, response: CandleApiResponse, symbol: string, resolution: string) {
    if (!isDevelopment()) {
      return;
    }

    logger.debug(`[tradingview-datafeed] ${action}`, {
      symbol,
      resolution,
      provider: response.selectedProvider ?? response.provider,
      fallbackUsed: response.fallbackUsed,
      marketStatus: response.marketStatus,
      stale: response.stale,
      reason: response.reason,
      circuitState: response.circuitState,
      candleCount: response.candles.length,
      fromCache: response.fromCache ?? false,
    });
  }

  async function pollSubscription(
    subscriberUID: string,
    onRealtimeCallback: RealtimeCallback,
    onResetCacheNeededCallback?: ResetCacheCallback
  ) {
    const subscription = subscriptions.get(subscriberUID);
    if (!subscription) {
      return;
    }

    try {
      const response = await requestCandles(subscription.symbolInfo.ticker, subscription.resolution, { limit: 3 });
      const bars = normalizeTradingViewBars(response);

      if (response.marketStatus !== "LIVE" || response.stale || bars.length === 0) {
        logDegradedState("subscribeBars degraded", response, subscription.symbolInfo.ticker, subscription.resolution);
      }

      const latestBar = bars.at(-1) ?? null;
      if (!latestBar) {
        return;
      }

      const previousBar = subscription.lastBar;
      const previousKey = tradingViewBarKey(previousBar);
      const nextKey = tradingViewBarKey(latestBar);

      if (!previousBar) {
        subscription.lastBar = latestBar;
        return;
      }

      if (latestBar.time < previousBar.time) {
        onResetCacheNeededCallback?.();
        subscription.lastBar = latestBar;
        return;
      }

      if (previousKey === nextKey) {
        return;
      }

      subscription.lastBar = latestBar;
      onRealtimeCallback(latestBar);
    } catch (error) {
      if (isDevelopment()) {
        logger.warn("[tradingview-datafeed] subscribeBars request failed", {
          subscriberUID,
          symbol: subscription.symbolInfo.ticker,
          resolution: subscription.resolution,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  }

  return {
    onReady(callback) {
      globalThis.setTimeout(() => callback(DATAFEED_CONFIGURATION), 0);
    },

    searchSymbols(userInput, exchange, symbolType, onResultReadyCallback) {
      onResultReadyCallback(searchTradingViewSymbols(userInput, exchange, symbolType));
    },

    resolveSymbol(symbolName, onSymbolResolvedCallback, onResolveErrorCallback) {
      const symbolInfo = toSymbolInfo(symbolName);

      if (!symbolInfo) {
        onResolveErrorCallback(`Unsupported symbol: ${symbolName}`);
        return;
      }

      onSymbolResolvedCallback(symbolInfo);
    },

    async getBars(symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback) {
      try {
        const response = await requestCandles(symbolInfo.ticker, resolution, {
          from: periodParams.from > 0 ? periodParams.from : undefined,
          to: periodParams.to > 0 ? periodParams.to : undefined,
          limit: Math.min(200, Math.max(2, periodParams.countBack ?? candleLimit)),
        });
        const bars = normalizeTradingViewBars(response);

        if (response.marketStatus !== "LIVE" || response.stale || bars.length === 0) {
          logDegradedState("getBars degraded", response, symbolInfo.ticker, resolution);
        }

        onHistoryCallback(bars, { noData: bars.length === 0 });
      } catch (error) {
        onErrorCallback(error instanceof Error ? error.message : "Unable to load candles");
      }
    },

    subscribeBars(symbolInfo, resolution, onRealtimeCallback, subscriberUID, onResetCacheNeededCallback) {
      this.unsubscribeBars(subscriberUID);

      if (!mapResolutionToTimeframe(resolution)) {
        if (isDevelopment()) {
          logger.warn("[tradingview-datafeed] unsupported subscription resolution", {
            symbol: symbolInfo.ticker,
            resolution,
          });
        }
        return;
      }

      const timer = setInterval(() => {
        void pollSubscription(subscriberUID, onRealtimeCallback, onResetCacheNeededCallback);
      }, pollIntervalMs);

      subscriptions.set(subscriberUID, {
        resolution: resolution as TradingViewResolution,
        symbolInfo,
        lastBar: null,
        timer,
      });

      void pollSubscription(subscriberUID, onRealtimeCallback, onResetCacheNeededCallback);
    },

    unsubscribeBars(subscriberUID) {
      const subscription = subscriptions.get(subscriberUID);
      if (!subscription) {
        return;
      }

      clearInterval(subscription.timer);
      subscriptions.delete(subscriberUID);
    },
  };
}

export default createTradingViewDatafeed;
