import { recordProviderHealth } from "@/lib/providerHealth";
import { orchestrateCandles } from "@/lib/marketData/candleOrchestrator";
import { orchestrateQuote } from "@/lib/marketData/quoteOrchestrator";
import { evaluateStyleReadiness } from "@/lib/marketData/policies/freshnessPolicy";
import type { MarketRequestContext } from "@/lib/marketData/policies/requestPolicy";
import { getCachedValue, setCachedValue } from "@/lib/runtime/runtimeCache";

const NEWS_KEY = process.env.NEWS_API_KEY ?? "";
const FRED_KEY = process.env.FRED_API_KEY ?? "";
const BINANCE_BASE = "https://api.binance.com/api/v3";
const REQUEST_TIMEOUT_MS = 8000;

const ASSET_PROVIDER: Record<string, "multi" | "binance"> = {
  EURUSD:  "multi",
  GBPUSD:  "multi",
  USDJPY:  "multi",
  USDCAD:  "multi",
  AUDUSD:  "multi",
  NZDUSD:  "multi",
  USDCHF:  "multi",
  EURJPY:  "multi",
  GBPJPY:  "multi",
  XAUUSD:  "multi",
  XAGUSD:  "multi",
  BTCUSDT: "binance",
  ETHUSDT: "binance",
};

export interface AssetPrice {
  symbol: string;
  price: number;
  source: string;
  timestamp: number;
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function redactUrl(url: string): string {
  return url.replace(/([?&])(api[_-]?key|apikey)=([^&]+)/gi, "$1$2=REDACTED");
}

async function safeFetchJson(url: string, label?: string): Promise<Record<string, unknown> | null> {
  const tag = label ?? redactUrl(url).replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const display = redactUrl(url);
  const provider =
    url.includes("newsapi.org") ? "NewsAPI" :
    url.includes("stlouisfed.org") ? "FRED" :
    url.includes("binance.com") ? "Binance" :
    url.includes("alternative.me") ? "Alternative.me" :
    "Unknown";
  const startedAt = Date.now();
  console.log(`[APEX:fetch] → ${tag}  ${display.slice(0, 120)}`);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) {
      await recordProviderHealth({
        provider,
        latencyMs: Date.now() - startedAt,
        status: "ERROR",
        errorRate: 1,
        detail: `http_${res.status}`,
      });
      console.warn(`[APEX:fetch] ✗ ${tag}  HTTP ${res.status} ${res.statusText}`);
      return null;
    }

    const json = await res.json() as Record<string, unknown>;
    const apiNote =
      json.Note ??
      json.Information ??
      json["Error Message"] ??
      json.error_message;

    if (apiNote) {
      await recordProviderHealth({
        provider,
        latencyMs: Date.now() - startedAt,
        status: "DEGRADED",
        errorRate: 1,
        detail: String(apiNote).slice(0, 200),
      });
      console.warn(`[APEX:fetch] ⚠ ${tag}  API-level error: ${String(apiNote).slice(0, 150)}`);
      return json;
    }

    await recordProviderHealth({
      provider,
      latencyMs: Date.now() - startedAt,
      status: "OK",
      errorRate: 0,
    });
    console.log(`[APEX:fetch] ✓ ${tag}  ok`);
    return json;
  } catch (error) {
    await recordProviderHealth({
      provider,
      latencyMs: Date.now() - startedAt,
      status: "ERROR",
      errorRate: 1,
      detail: `exception:${String(error).slice(0, 160)}`,
    });
    console.error(`[APEX:fetch] ✗ ${tag}  exception:`, error);
    return null;
  }
}

function toPositiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function trendFromCloses(closes: number[]): "uptrend" | "downtrend" | "consolidation" {
  if (closes.length < 6) return "consolidation";
  const half = Math.floor(closes.length / 2);
  const early = closes.slice(0, half).reduce((a, b) => a + b, 0) / half;
  const late = closes.slice(-half).reduce((a, b) => a + b, 0) / half;
  if (late > early * 1.01) return "uptrend";
  if (late < early * 0.99) return "downtrend";
  return "consolidation";
}

export function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);

  let avgGain = changes.slice(0, period).reduce((s, c) => s + Math.max(c, 0), 0) / period;
  let avgLoss = changes.slice(0, period).reduce((s, c) => s + Math.max(-c, 0), 0) / period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + Math.max(changes[i], 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-changes[i], 0)) / period;
  }

  if (avgLoss === 0) return 100;
  return Math.round(100 - 100 / (1 + avgGain / avgLoss));
}

const BULLISH_WORDS = ["rally", "surge", "rise", "gain", "high", "bullish", "up", "boost", "climb", "record", "strong", "buy"];
const BEARISH_WORDS = ["fall", "drop", "crash", "decline", "low", "weak", "bearish", "down", "plunge", "sell", "slump", "loss"];

export function analyzeSentiment(title: string): "bullish" | "bearish" | "neutral" {
  const t = title.toLowerCase();
  const bullish = BULLISH_WORDS.filter(word => t.includes(word)).length;
  const bearish = BEARISH_WORDS.filter(word => t.includes(word)).length;
  if (bullish > bearish) return "bullish";
  if (bearish > bullish) return "bearish";
  return "neutral";
}

function summarizeCandleProvider(
  result: Awaited<ReturnType<typeof orchestrateCandles>>
) {
  return {
    selectedProvider: result.selectedProvider ?? result.provider,
    fallbackUsed: result.fallbackUsed,
    freshnessMs: result.freshnessMs,
    circuitState: result.circuitState,
    marketStatus: result.marketStatus,
    reason: result.reason,
    sourceType: result.sourceType,
    freshnessClass: result.freshnessClass,
    degraded: result.degraded,
    providerHealthScore: result.providerHealthScore,
  };
}

export async function getBinancePrice(symbol: string): Promise<number | null> {
  const startedAt = Date.now();
  const url = `${BINANCE_BASE}/ticker/price?symbol=${symbol}`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) {
      console.error(`[Binance] HTTP ${res.status} ${res.statusText} for ${symbol}`);
      await recordProviderHealth({
        provider: "Binance",
        requestSymbol: symbol,
        latencyMs: Date.now() - startedAt,
        status: "ERROR",
        errorRate: 1,
        detail: `http_${res.status}`,
      });
      return null;
    }

    const data = await res.json() as { price?: string };
    const price = toPositiveNumber(data.price);
    if (price == null) {
      console.error(`[Binance] Invalid price payload for ${symbol}: ${JSON.stringify(data).slice(0, 200)}`);
      await recordProviderHealth({
        provider: "Binance",
        requestSymbol: symbol,
        latencyMs: Date.now() - startedAt,
        status: "DEGRADED",
        errorRate: 1,
        detail: "parse_failure:invalid_price",
      });
      return null;
    }

    await recordProviderHealth({
      provider: "Binance",
      requestSymbol: symbol,
      latencyMs: Date.now() - startedAt,
      status: "OK",
      errorRate: 0,
    });
    return price;
  } catch (error) {
    console.error(`[Binance] Request failed for ${symbol}:`, error);
    await recordProviderHealth({
      provider: "Binance",
      requestSymbol: symbol,
      latencyMs: Date.now() - startedAt,
      status: "ERROR",
      errorRate: 1,
      detail: `exception:${String(error).slice(0, 160)}`,
    });
    return null;
  }
}

export async function getAssetPrice(symbol: string): Promise<AssetPrice | null> {
  const provider = ASSET_PROVIDER[symbol];
  if (!provider) {
    console.error(`[marketData] No provider mapping for ${symbol}`);
    return null;
  }

  if (provider === "binance") {
    const price = await getBinancePrice(symbol);
    return price != null
      ? { symbol, price, source: "binance", timestamp: Date.now() }
      : null;
  }

  // FOREX/COMMODITY: Yahoo Finance is the sole provider — call it directly
  // without going through the orchestrators (which previously triggered FCS).
  const { fetchYahooPrice } = await import("@/lib/providers/yahooFinance");
  const yahoo = await fetchYahooPrice(symbol);
  return yahoo.price != null
    ? { symbol, price: yahoo.price, source: "Yahoo Finance", timestamp: Date.now() }
    : null;
}

async function getAssetPriceWithRetry(symbol: string, retries = 2): Promise<AssetPrice | null> {
  for (let i = 0; i < retries; i += 1) {
    const result = await getAssetPrice(symbol);
    if (result) return result;
    if (i < retries - 1) {
      await delay(500);
    }
  }

  console.warn(`[marketData] ${symbol} unavailable after ${retries} attempts`);
  return null;
}

export async function getAllAssetPrices(): Promise<Record<string, AssetPrice | null>> {
  const entries = await Promise.allSettled(
    Object.keys(ASSET_PROVIDER).map(async symbol => [symbol, await getAssetPriceWithRetry(symbol)] as const)
  );

  return entries.reduce<Record<string, AssetPrice | null>>((acc, result) => {
    if (result.status === "fulfilled") {
      acc[result.value[0]] = result.value[1];
    }
    return acc;
  }, {});
}

export async function fetchCryptoData(symbol: string, context?: MarketRequestContext) {
  console.log(`[APEX:crypto] Fetching ${symbol}...`);
  const [quote, dayCandles, readinessCandles, tickerData, fearGreedResponse] = await Promise.all([
    orchestrateQuote(symbol, "CRYPTO", context),
    orchestrateCandles(symbol, "CRYPTO", "1D", context),
    Promise.all([
      orchestrateCandles(symbol, "CRYPTO", "1m", context),
      orchestrateCandles(symbol, "CRYPTO", "5m", context),
      orchestrateCandles(symbol, "CRYPTO", "15m", context),
      orchestrateCandles(symbol, "CRYPTO", "1h", context),
      orchestrateCandles(symbol, "CRYPTO", "4h", context),
      orchestrateCandles(symbol, "CRYPTO", "1D", context),
    ]),
    safeFetchJson(`${BINANCE_BASE}/ticker/24hr?symbol=${symbol}`, `binance-ticker-${symbol}`),
    safeFetchJson("https://api.alternative.me/fng/?limit=1", "fear-greed"),
  ]);

  const dailyCandles = dayCandles.candles;
  const closes = dailyCandles.map(row => Number(row.close));
  const highs = dailyCandles.map(row => Number(row.high));
  const lows = dailyCandles.map(row => Number(row.low));
  const fearGreedData = (fearGreedResponse as Record<string, unknown> | null)?.data as Array<Record<string, string>> | undefined;
  const price = quote.price != null && quote.price > 0 ? quote.price : null;
  const readiness = evaluateStyleReadiness({
    "1m": readinessCandles[0],
    "5m": readinessCandles[1],
    "15m": readinessCandles[2],
    "1h": readinessCandles[3],
    "4h": readinessCandles[4],
    "1D": readinessCandles[5],
  });

  console.log(`[APEX:crypto] ${symbol} → price=${price}, closes=${closes.length}, fearGreed=${fearGreedData?.[0]?.value ?? "null"}`);

  return {
    price,
    change24h: quote.change24h ?? toPositiveNumber((tickerData as Record<string, unknown> | null)?.priceChangePercent) ?? null,
    volume: quote.volume ?? toPositiveNumber((tickerData as Record<string, unknown> | null)?.volume) ?? null,
    high14d: highs.length ? Math.max(...highs) : null,
    low14d: lows.length ? Math.min(...lows) : null,
    candles: dailyCandles.map(row => ({
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
    })),
    closes,
    readiness,
    stale: quote.stale || quote.marketStatus !== "LIVE",
    marketStatus: quote.marketStatus,
    reason: quote.reason,
    updatedAt: quote.timestamp != null ? new Date(quote.timestamp).toISOString() : null,
    provider: quote.selectedProvider ?? quote.provider,
    fallbackUsed: quote.fallbackUsed,
    freshnessMs: quote.freshnessMs,
    circuitState: quote.circuitState,
    sourceType: quote.sourceType,
    freshnessClass: quote.freshnessClass,
    degraded: quote.degraded,
    providerHealthScore: quote.providerHealthScore,
    candleProviders: {
      "1m": summarizeCandleProvider(readinessCandles[0]),
      "5m": summarizeCandleProvider(readinessCandles[1]),
      "15m": summarizeCandleProvider(readinessCandles[2]),
      "1h": summarizeCandleProvider(readinessCandles[3]),
      "4h": summarizeCandleProvider(readinessCandles[4]),
      "1D": summarizeCandleProvider(readinessCandles[5]),
    },
    fearGreed: fearGreedData?.[0]
      ? { value: fearGreedData[0].value, label: fearGreedData[0].value_classification }
      : null,
  };
}

async function fetchMultiProviderAsset(apexSymbol: string, _assetClass: "FOREX" | "COMMODITY", _context?: MarketRequestContext) {
  const { fetchYahooPrice } = await import("@/lib/providers/yahooFinance");
  const yahoo = await fetchYahooPrice(apexSymbol);

  const isReady = yahoo.price !== null;
  const yahooProvider = {
    selectedProvider:    "Yahoo Finance",
    fallbackUsed:        false,
    freshnessMs:         0,
    circuitState:        "closed" as const,
    marketStatus:        "LIVE"  as const,
    reason:              null,
    sourceType:          "fresh"  as const,
    freshnessClass:      "fresh"  as const,
    degraded:            false,
    providerHealthScore: 1,
  };

  return {
    price:               yahoo.price,
    change24h:           yahoo.change24h,
    high14d:             yahoo.high14d,
    low14d:              yahoo.low14d,
    closes:              yahoo.closes,
    stale:               !isReady,
    marketStatus:        isReady ? "LIVE" as const : "UNAVAILABLE" as const,
    reason:              isReady ? null : "yahoo_unavailable",
    updatedAt:           new Date().toISOString(),
    provider:            "Yahoo Finance",
    fallbackUsed:        false,
    freshnessMs:         0,
    circuitState:        "closed" as const,
    sourceType:          "fresh"  as const,
    freshnessClass:      "fresh"  as const,
    degraded:            !isReady,
    providerHealthScore: isReady ? 1 : 0,
    candleProviders: {
      "1m":  { ...yahooProvider },
      "5m":  { ...yahooProvider },
      "15m": { ...yahooProvider },
      "1h":  { ...yahooProvider },
      "4h":  { ...yahooProvider },
      "1D":  { ...yahooProvider },
    },
    readiness: {
      SCALP:    { ready: false,    missing: ["1m", "5m"] as string[], stale: [] as string[] },
      INTRADAY: { ready: isReady,  missing: [] as string[],           stale: [] as string[] },
      SWING:    { ready: isReady,  missing: [] as string[],           stale: [] as string[] },
    },
  };
}

export async function fetchForexData(fromCurrency: string, toCurrency: string, context?: MarketRequestContext) {
  const symbol = `${fromCurrency}${toCurrency}`;
  const data = await fetchMultiProviderAsset(symbol, "FOREX", context);
  console.log(`[APEX:forex] ${symbol} → price=${data.price}, closes=${data.closes.length}`);
  return data;
}

export async function fetchCommodityData(fromSymbol: string, context?: MarketRequestContext) {
  const symbol = `${fromSymbol}USD`;
  const data = await fetchMultiProviderAsset(symbol, "COMMODITY", context);
  console.log(`[APEX:commodity] ${symbol} → price=${data.price}, closes=${data.closes.length}`);
  return data;
}

function latestFred(series: Record<string, unknown> | null): string | null {
  const observations = series?.observations as Array<Record<string, string>> | undefined;
  return observations?.[0]?.value ?? null;
}

function fredTrend(series: Record<string, unknown> | null): "rising" | "falling" | "flat" {
  const observations = series?.observations as Array<Record<string, string>> | undefined;
  if (!observations || observations.length < 2) return "flat";
  const latest = Number(observations[0].value ?? "0");
  const previous = Number(observations[1].value ?? "0");
  if (latest > previous * 1.001) return "rising";
  if (latest < previous * 0.999) return "falling";
  return "flat";
}

export async function fetchMacroData(context?: MarketRequestContext) {
  const priority = context?.priority ?? "cold";
  const freshTtlMs = priority === "hot" ? 10 * 60_000 : priority === "warm" ? 20 * 60_000 : 45 * 60_000;
  const staleTtlMs = priority === "hot" ? 60 * 60_000 : priority === "warm" ? 3 * 60 * 60_000 : 12 * 60 * 60_000;
  const cacheKey = "market:macro:fred";
  const cached = await getCachedValue<{
    data: {
      fedFundsRate: string | null;
      fedTrend: "rising" | "falling" | "flat";
      cpi: string | null;
      cpiTrend: "rising" | "falling" | "flat";
      treasury10y: string | null;
      gdp: string | null;
    };
    fetchedAt: number;
    freshUntil: number;
    staleUntil: number;
  }>(cacheKey);
  const now = Date.now();
  if (cached && cached.freshUntil > now) {
    return cached.data;
  }

  console.log(`[APEX:macro] Fetching FRED data... (FRED_KEY ${FRED_KEY ? "set" : "MISSING"})`);
  const base = "https://api.stlouisfed.org/fred/series/observations";
  const params = `&limit=3&sort_order=desc&api_key=${FRED_KEY}&file_type=json`;

  const [funds, cpi, treasury, gdp] = await Promise.all([
    safeFetchJson(`${base}?series_id=FEDFUNDS${params}`, "FRED-FEDFUNDS"),
    safeFetchJson(`${base}?series_id=CPIAUCSL${params}`, "FRED-CPIAUCSL"),
    safeFetchJson(`${base}?series_id=GS10${params}`, "FRED-GS10"),
    safeFetchJson(`${base}?series_id=GDP${params}`, "FRED-GDP"),
  ]);

  const result = {
    fedFundsRate: latestFred(funds),
    fedTrend: fredTrend(funds),
    cpi: latestFred(cpi),
    cpiTrend: fredTrend(cpi),
    treasury10y: latestFred(treasury),
    gdp: latestFred(gdp),
  };

  if (result.fedFundsRate || result.cpi || result.treasury10y || result.gdp) {
    await setCachedValue(cacheKey, {
      data: result,
      fetchedAt: now,
      freshUntil: now + freshTtlMs,
      staleUntil: now + staleTtlMs,
    }, staleTtlMs);
  } else if (cached && cached.staleUntil > now) {
    return cached.data;
  }

  console.log(`[APEX:macro] → fedFunds=${result.fedFundsRate}, cpi=${result.cpi}, gdp=${result.gdp}`);
  return result;
}

export async function fetchNewsBundle(query: string, context?: MarketRequestContext) {
  const priority = context?.priority ?? "cold";
  const freshTtlMs = priority === "hot" ? 2 * 60_000 : priority === "warm" ? 10 * 60_000 : 30 * 60_000;
  const staleTtlMs = priority === "hot" ? 10 * 60_000 : priority === "warm" ? 45 * 60_000 : 6 * 60 * 60_000;
  const cacheKey = `market:news:${query.toLowerCase()}`;
  const cached = await getCachedValue<{
    articles: Array<{ title: string; source: string; publishedAt: string; sentiment: "bullish" | "bearish" | "neutral" }>;
    fetchedAt: number;
    freshUntil: number;
    staleUntil: number;
  }>(cacheKey);
  const now = Date.now();
  const cachedFresh = cached && cached.freshUntil > now;
  const cachedStale = cached && cached.staleUntil > now;

  if (cachedFresh) {
    return {
      articles: cached.articles,
      status: "LIVE" as const,
      reason: null,
      degraded: false,
      sourceType: "cache" as const,
      fetchedAt: cached.fetchedAt,
    };
  }

  console.log(`[APEX:news] Fetching news for "${query}"... (NEWS_KEY ${NEWS_KEY ? "set" : "MISSING"})`);
  const data = await safeFetchJson(
    `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=10&language=en&apiKey=${NEWS_KEY}`,
    `newsapi-${query}`,
  );

  const articles = ((data as Record<string, unknown>)?.articles ?? []) as Array<Record<string, unknown>>;
  console.log(`[APEX:news] "${query}" → ${articles.length} articles`);

  const normalized = articles.slice(0, 10).map(article => ({
    title: String(article.title ?? ""),
    source: String((article.source as Record<string, string>)?.name ?? ""),
    publishedAt: String(article.publishedAt ?? ""),
    sentiment: analyzeSentiment(String(article.title ?? "")),
  }));

  if (normalized.length > 0) {
    await setCachedValue(cacheKey, {
      articles: normalized,
      fetchedAt: now,
      freshUntil: now + freshTtlMs,
      staleUntil: now + staleTtlMs,
    }, staleTtlMs);

    return {
      articles: normalized,
      status: "LIVE" as const,
      reason: null,
      degraded: false,
      sourceType: cachedStale ? "fresh" as const : "fresh" as const,
      fetchedAt: now,
    };
  }

  if (cachedStale) {
    return {
      articles: cached.articles,
      status: "DEGRADED" as const,
      reason: "news_unavailable",
      degraded: true,
      sourceType: "stale-cache" as const,
      fetchedAt: cached.fetchedAt,
    };
  }

  return {
    articles: [] as Array<{ title: string; source: string; publishedAt: string; sentiment: "bullish" | "bearish" | "neutral" }>,
    status: "UNAVAILABLE" as const,
    reason: "news_unavailable",
    degraded: true,
    sourceType: "fallback" as const,
    fetchedAt: null,
  };
}

export async function fetchNews(query: string, context?: MarketRequestContext) {
  const bundle = await fetchNewsBundle(query, context);
  return bundle.articles;
}

export async function fetchTechnicals(symbol: string, assetClass: string, closes?: number[]) {
  if (closes && closes.length > 0) {
    const rsi = computeRSI(closes);
    const trend = trendFromCloses(closes);
    console.log(`[APEX:tech] ${symbol} (${assetClass} from closes) → rsi=${rsi}, trend=${trend}`);
    return {
      rsi,
      macdSignal: null as string | null,
      macdHist: null as number | null,
      trend,
    };
  }

  console.log(`[APEX:tech] ${symbol} (${assetClass}) — no closes available`);
  return {
    rsi: null,
    macdSignal: null as string | null,
    macdHist: null as number | null,
    trend: null as string | null,
  };
}
