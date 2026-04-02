import { recordProviderHealth } from "@/lib/providerHealth";

type YahooTimeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1D";

type YahooChartResult = {
  timestamp?: Array<number | null>;
  indicators?: {
    quote?: Array<{
      open?: Array<number | null>;
      high?: Array<number | null>;
      low?: Array<number | null>;
      close?: Array<number | null>;
      volume?: Array<number | null>;
    }>;
  };
};

type YahooResponse = {
  chart?: {
    result?: YahooChartResult[] | null;
  };
};

type YahooBar = {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const YAHOO_HOSTS = [
  "https://query1.finance.yahoo.com",
  "https://query2.finance.yahoo.com",
] as const;

const REQUEST_TIMEOUT_MS = 4_000;

const YAHOO_SYMBOL_MAP: Record<string, string> = {
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "USDJPY=X",
  USDCAD: "CAD=X",
  AUDUSD: "AUDUSD=X",
  NZDUSD: "NZDUSD=X",
  USDCHF: "CHF=X",
  EURJPY: "EURJPY=X",
  GBPJPY: "GBPJPY=X",
  XAUUSD: "GC=F",
  XAGUSD: "SI=F",
  WTICOUSD: "CL=F",
  BCOUSD: "BZ=F",
  NATGASUSD: "NG=F",
  SPX: "^GSPC",
  NDX: "^NDX",
  DJI: "^DJI",
  UKX: "^FTSE",
  DAX: "^GDAXI",
  NKY: "^N225",
  BTCUSD: "BTC-USD",
  ETHUSD: "ETH-USD",
};

const YAHOO_CANONICAL_ALIASES: Record<string, string> = {
  "GC=F": "XAUUSD",
  GOLD: "XAUUSD",
  "XAU/USD": "XAUUSD",
};

const TIMEFRAME_PARAMS: Record<YahooTimeframe, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "1d" },
  "5m": { interval: "5m", range: "2d" },
  "15m": { interval: "15m", range: "5d" },
  "1h": { interval: "1h", range: "5d" },
  "4h": { interval: "60m", range: "30d" },
  "1D": { interval: "1d", range: "60d" },
};

function bucketIntervalMs(timeframe: YahooTimeframe): number {
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

function aggregateBars(bars: YahooBar[], timeframe: YahooTimeframe): YahooBar[] {
  if (timeframe !== "4h") {
    return bars;
  }

  const bucketMs = bucketIntervalMs(timeframe);
  const grouped = new Map<number, YahooBar[]>();

  for (const bar of bars) {
    const timestamp = new Date(bar.datetime).getTime();
    const bucket = Math.floor(timestamp / bucketMs) * bucketMs;
    if (!grouped.has(bucket)) {
      grouped.set(bucket, []);
    }
    grouped.get(bucket)!.push(bar);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucket, group]) => ({
      datetime: new Date(bucket).toISOString(),
      open: group[0]?.open ?? group[0]?.close ?? 0,
      high: Math.max(...group.map(item => item.high)),
      low: Math.min(...group.map(item => item.low)),
      close: group.at(-1)?.close ?? group[0]?.close ?? 0,
      volume: group.reduce((sum, item) => sum + (item.volume ?? 0), 0),
    }))
    .filter(bar => bar.open > 0 && bar.high > 0 && bar.low > 0 && bar.close > 0);
}

export function normalizeYahooTimeframe(interval: string): YahooTimeframe {
  const normalized = interval.trim().toLowerCase();
  if (normalized === "1m" || normalized === "1min") return "1m";
  if (normalized === "5m" || normalized === "5min") return "5m";
  if (normalized === "15m" || normalized === "15min") return "15m";
  if (normalized === "1h" || normalized === "60m" || normalized === "60min") return "1h";
  if (normalized === "4h" || normalized === "240m" || normalized === "240min") return "4h";
  if (normalized === "1d" || normalized === "d" || normalized === "day" || normalized === "daily") return "1D";
  return "1D";
}

export function resolveYahooSymbol(apexSymbol: string): string | null {
  const normalizedApexSymbol = YAHOO_CANONICAL_ALIASES[apexSymbol.toUpperCase()] ?? apexSymbol;

  if (YAHOO_SYMBOL_MAP[normalizedApexSymbol]) {
    return YAHOO_SYMBOL_MAP[normalizedApexSymbol];
  }

  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalizedApexSymbol)) {
    return normalizedApexSymbol;
  }

  return null;
}

async function fetchYahooJson(path: string): Promise<{
  payload: YahooResponse | null;
  host: string | null;
  latencyMs: number | null;
} | null> {
  for (const host of YAHOO_HOSTS) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${host}/v8/finance/chart${path}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json",
        },
        cache: "no-store",
      });
      if (!response.ok) {
        continue;
      }
      return {
        payload: await response.json() as YahooResponse,
        host,
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      continue;
    }
  }

  return null;
}

export async function fetchYahooBars(apexSymbol: string, interval: string): Promise<{
  sourceSymbol: string;
  interval: YahooTimeframe;
  values: YahooBar[];
} | null> {
  const normalizedApexSymbol = YAHOO_CANONICAL_ALIASES[apexSymbol.toUpperCase()] ?? apexSymbol;
  const sourceSymbol = resolveYahooSymbol(normalizedApexSymbol);
  if (!sourceSymbol) {
    return null;
  }

  const timeframe = normalizeYahooTimeframe(interval);
  const params = TIMEFRAME_PARAMS[timeframe];
  const path = `/${encodeURIComponent(sourceSymbol)}?interval=${params.interval}&range=${params.range}&includePrePost=false`;
  const response = await fetchYahooJson(path);
  const result = response?.payload?.chart?.result?.[0];
  if (!result) {
    await recordProviderHealth({
      provider: "Yahoo",
      requestSymbol: normalizedApexSymbol,
      status: "no_data",
      latencyMs: response?.latencyMs ?? null,
      detail: `asset_lookup symbol=${normalizedApexSymbol} source=${sourceSymbol} timeframe=${timeframe} empty_or_missing_result=true`,
    });
    return null;
  }

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const values = timestamps
    .map((timestamp, index) => {
      const open = quote.open?.[index];
      const high = quote.high?.[index];
      const low = quote.low?.[index];
      const close = quote.close?.[index];
      const volume = quote.volume?.[index];
      if (
        timestamp == null ||
        open == null || !Number.isFinite(open) || open <= 0 ||
        high == null || !Number.isFinite(high) || high <= 0 ||
        low == null || !Number.isFinite(low) || low <= 0 ||
        close == null || !Number.isFinite(close) || close <= 0
      ) {
        return null;
      }

      return {
        datetime: new Date(timestamp * 1000).toISOString(),
        open,
        high,
        low,
        close,
        volume: typeof volume === "number" && Number.isFinite(volume) ? volume : 0,
      } satisfies YahooBar;
    })
    .filter((bar): bar is YahooBar => bar != null);

  const normalizedValues = aggregateBars(values, timeframe);
  if (normalizedValues.length === 0) {
    await recordProviderHealth({
      provider: "Yahoo",
      requestSymbol: normalizedApexSymbol,
      status: "empty_body",
      latencyMs: response?.latencyMs ?? null,
      detail: `asset_lookup symbol=${normalizedApexSymbol} source=${sourceSymbol} timeframe=${timeframe} empty_bar_set=true`,
    });
    return null;
  }

  await recordProviderHealth({
    provider: "Yahoo",
    requestSymbol: normalizedApexSymbol,
    status: "healthy",
    latencyMs: response?.latencyMs ?? null,
    detail: `asset_lookup symbol=${normalizedApexSymbol} source=${sourceSymbol} timeframe=${timeframe} bars=${normalizedValues.length}`,
  });

  return {
    sourceSymbol,
    interval: timeframe,
    values: normalizedValues,
  };
}
