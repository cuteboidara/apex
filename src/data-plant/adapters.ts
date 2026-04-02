import type { CandleTimeframe, NormalizedCandle, ProviderHealthMetadata } from "@/src/interfaces/contracts";
import { emptyEconomicEventContext } from "@/src/data-plant/economicEvents";
import { classifyFxSession } from "@/src/data-plant/session";
import { logger } from "@/src/lib/logger";
import { fetchYahooBars, normalizeYahooTimeframe } from "@/src/lib/yahooFinance";

export interface MarketDataFetchResult {
  provider: string;
  candles: NormalizedCandle[];
  health: ProviderHealthMetadata;
}

export interface MarketDataProviderAdapter {
  readonly providerName: string;
  fetchCandles(symbol: string, timeframe: string): Promise<MarketDataFetchResult | null>;
}

type OandaEnvironment = "practice" | "live";
type OandaGranularity = "M1" | "M5" | "M15" | "H1" | "H4" | "D";

type OandaCandle = {
  complete?: boolean;
  time?: string;
  volume?: number;
  mid?: {
    o?: string;
    h?: string;
    l?: string;
    c?: string;
  };
};

type OandaCandlesResponse = {
  candles?: OandaCandle[];
};

const OANDA_HOSTS: Record<OandaEnvironment, string> = {
  practice: "https://api-fxpractice.oanda.com",
  live: "https://api-fxtrade.oanda.com",
};

const OANDA_SYMBOL_MAP: Record<string, string> = {
  EURUSD: "EUR_USD",
  GBPUSD: "GBP_USD",
  USDJPY: "USD_JPY",
  EURJPY: "EUR_JPY",
  AUDUSD: "AUD_USD",
  NZDUSD: "NZD_USD",
  USDCHF: "USD_CHF",
  USDCAD: "USD_CAD",
};

const OANDA_GRANULARITY_MAP: Record<CandleTimeframe, OandaGranularity> = {
  "1m": "M1",
  "5m": "M5",
  "15m": "M15",
  "1h": "H1",
  "4h": "H4",
  "1D": "D",
};

const OANDA_CANDLE_COUNT = 96;
const REQUEST_TIMEOUT_MS = 8_000;
const OANDA_AUTH_FAILURE_COOLDOWN_MS = 5 * 60_000;

const globalForOandaAdapter = globalThis as typeof globalThis & {
  __apexOandaAuthFailureUntil?: number;
};

function normalizeTimeframe(interval: string): CandleTimeframe {
  const normalized = interval.trim().toLowerCase();
  if (normalized === "1m" || normalized === "1min") return "1m";
  if (normalized === "5m" || normalized === "5min") return "5m";
  if (normalized === "15m" || normalized === "15min") return "15m";
  if (normalized === "1h" || normalized === "60m" || normalized === "60min") return "1h";
  if (normalized === "4h" || normalized === "240m" || normalized === "240min") return "4h";
  return "1D";
}

function timeframeToMs(timeframe: CandleTimeframe): number {
  switch (timeframe) {
    case "1m":
      return 60_000;
    case "5m":
      return 5 * 60_000;
    case "15m":
      return 15 * 60_000;
    case "1h":
      return 60 * 60_000;
    case "4h":
      return 4 * 60 * 60_000;
    case "1D":
      return 24 * 60 * 60_000;
  }
}

function parseNumericValue(value: string | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOandaTimestampMs(value: string | undefined): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  if (/^\d+(\.\d+)?$/.test(value)) {
    const unixSeconds = Number(value);
    return Number.isFinite(unixSeconds) ? Math.round(unixSeconds * 1000) : null;
  }

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function resolveOandaInstrument(symbol: string): string | null {
  return OANDA_SYMBOL_MAP[symbol] ?? null;
}

function resolveOandaBaseUrl(environment: OandaEnvironment, overrideBaseUrl?: string): string {
  const trimmedOverride = overrideBaseUrl?.trim();
  if (trimmedOverride) {
    return trimmedOverride.replace(/\/+$/, "");
  }

  return OANDA_HOSTS[environment];
}

export class OandaAdapter implements MarketDataProviderAdapter {
  readonly providerName = "oanda";

  constructor(
    private readonly options: {
      apiToken?: string;
      environment?: OandaEnvironment;
      baseUrl?: string;
      fetchImpl?: typeof fetch;
    } = {},
  ) {}

  async fetchCandles(symbol: string, timeframe: string): Promise<MarketDataFetchResult | null> {
    const apiToken = this.options.apiToken?.trim();
    if (!apiToken) {
      return null;
    }

    const authFailureUntil = globalForOandaAdapter.__apexOandaAuthFailureUntil ?? 0;
    if (Date.now() < authFailureUntil) {
      return null;
    }

    const instrument = resolveOandaInstrument(symbol);
    if (!instrument) {
      return null;
    }

    const normalizedTimeframe = normalizeTimeframe(timeframe);
    const granularity = OANDA_GRANULARITY_MAP[normalizedTimeframe];
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
    const baseUrl = resolveOandaBaseUrl(this.options.environment ?? "practice", this.options.baseUrl);
    const startedAt = Date.now();

    try {
      const response = await fetchImpl(
        `${baseUrl}/v3/instruments/${encodeURIComponent(instrument)}/candles?price=M&granularity=${granularity}&count=${OANDA_CANDLE_COUNT}`,
        {
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Accept-Datetime-Format": "UNIX",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) {
        const responseBody = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          globalForOandaAdapter.__apexOandaAuthFailureUntil = Date.now() + OANDA_AUTH_FAILURE_COOLDOWN_MS;
        }
        logger.warn({
          module: "data-plant",
          message: `[APEX DATA] Oanda failed for ${symbol}, falling back to Yahoo`,
          symbol,
          provider: this.providerName,
          status: response.status,
          response_body: responseBody,
        });
        return null;
      }

      const payload = await response.json() as OandaCandlesResponse;
      const stepMs = timeframeToMs(normalizedTimeframe);
      const candles = (payload.candles ?? []).flatMap(candle => {
        if (!candle.complete || !candle.mid) {
          return [];
        }

        const open = parseNumericValue(candle.mid.o);
        const high = parseNumericValue(candle.mid.h);
        const low = parseNumericValue(candle.mid.l);
        const close = parseNumericValue(candle.mid.c);
        const timestampOpen = parseOandaTimestampMs(candle.time);
        if (
          open == null || open <= 0
          || high == null || high <= 0
          || low == null || low <= 0
          || close == null || close <= 0
          || timestampOpen == null
        ) {
          return [];
        }

        return [{
          symbol,
          timeframe: normalizedTimeframe,
          open,
          high,
          low,
          close,
          volume: typeof candle.volume === "number" && Number.isFinite(candle.volume) ? candle.volume : null,
          timestampOpen,
          timestampClose: timestampOpen + stepMs,
          source: this.providerName,
          qualityFlag: "clean",
          ...classifyFxSession(timestampOpen),
          ...emptyEconomicEventContext(),
        } satisfies NormalizedCandle];
      });

      if (candles.length === 0) {
        return null;
      }

      globalForOandaAdapter.__apexOandaAuthFailureUntil = 0;

      return {
        provider: this.providerName,
        candles,
        health: {
          provider: this.providerName,
          latencyMs: Math.max(0, Date.now() - startedAt),
          missingBars: 0,
          duplicateBars: 0,
          outOfOrderBars: 0,
          staleLastCandle: false,
          abnormalGapDetected: false,
        },
      };
    } catch (error) {
      logger.warn({
        module: "data-plant",
        message: `[APEX DATA] Oanda failed for ${symbol}, falling back to Yahoo`,
        symbol,
        provider: this.providerName,
        error: String(error),
      });
      return null;
    }
  }
}

export class YahooAdapter implements MarketDataProviderAdapter {
  readonly providerName = "yahoo-finance";

  async fetchCandles(symbol: string, timeframe: string): Promise<MarketDataFetchResult | null> {
    const startedAt = Date.now();
    const result = await fetchYahooBars(symbol, timeframe);
    if (!result || result.values.length === 0) {
      return null;
    }

    const normalizedTimeframe = normalizeYahooTimeframe(timeframe);
    const stepMs = timeframeToMs(normalizedTimeframe);
    const candles = result.values.map(bar => {
      const timestampOpen = new Date(bar.datetime).getTime();
      return {
        symbol,
        timeframe: normalizedTimeframe,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume > 0 ? bar.volume : null,
        timestampOpen,
        timestampClose: timestampOpen + stepMs,
        source: this.providerName,
        qualityFlag: "clean",
        ...classifyFxSession(timestampOpen),
        ...emptyEconomicEventContext(),
      } satisfies NormalizedCandle;
    });

    return {
      provider: this.providerName,
      candles,
      health: {
        provider: this.providerName,
        latencyMs: Math.max(0, Date.now() - startedAt),
        missingBars: 0,
        duplicateBars: 0,
        outOfOrderBars: 0,
        staleLastCandle: false,
        abnormalGapDetected: false,
      },
    };
  }
}
