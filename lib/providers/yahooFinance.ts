const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";
const REQUEST_TIMEOUT_MS = 8000;

const SYMBOL_MAP: Record<string, string> = {
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "USDJPY=X",
  XAUUSD: "GC=F",
  XAGUSD: "SI=F",
  BTCUSDT: "BTC-USD",
  ETHUSDT: "ETH-USD",
};

interface YahooChartResult {
  meta?: { regularMarketPrice?: number };
  indicators?: { quote?: Array<{ close?: (number | null)[] }> };
}

interface YahooResponse {
  chart?: { result?: YahooChartResult[] | null; error?: unknown };
}

export async function fetchYahooPrice(apexSymbol: string): Promise<{ price: number | null; closes: number[] }> {
  const yahooSymbol = SYMBOL_MAP[apexSymbol];
  if (!yahooSymbol) {
    return { price: null, closes: [] };
  }

  try {
    const url = `${YAHOO_BASE}/${encodeURIComponent(yahooSymbol)}?interval=1d&range=60d`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0" },
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(`[APEX:yahoo] HTTP ${res.status} for ${apexSymbol} (${yahooSymbol})`);
      return { price: null, closes: [] };
    }

    const data = await res.json() as YahooResponse;
    const result = data?.chart?.result?.[0];

    if (!result) {
      console.error(`[APEX:yahoo] No chart result for ${apexSymbol}`);
      return { price: null, closes: [] };
    }

    const price = typeof result.meta?.regularMarketPrice === "number" && result.meta.regularMarketPrice > 0
      ? result.meta.regularMarketPrice
      : null;

    const rawCloses = result.indicators?.quote?.[0]?.close ?? [];
    const closes = rawCloses
      .filter((c): c is number => typeof c === "number" && Number.isFinite(c) && c > 0);

    console.log(`[APEX:yahoo] ${apexSymbol} → price=${price}, closes=${closes.length}`);
    return { price, closes };
  } catch (err) {
    console.error(`[APEX:yahoo] Request failed for ${apexSymbol}:`, err);
    return { price: null, closes: [] };
  }
}
