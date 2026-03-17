const TWELVE_DATA_BASE = "https://api.twelvedata.com";
const REQUEST_TIMEOUT_MS = 8000;

const SYMBOL_MAP: Record<string, string> = {
  EURUSD: "EUR/USD",
  GBPUSD: "GBP/USD",
  USDJPY: "USD/JPY",
  XAUUSD: "XAU/USD",
  XAGUSD: "XAG/USD",
};

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getMappedSymbol(apexSymbol: string) {
  return SYMBOL_MAP[apexSymbol];
}

async function fetchTwelveDataJson(path: string, params: Record<string, string>) {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey || apiKey === "PASTE_YOUR_KEY_HERE") {
    console.error("[TwelveData] Missing TWELVE_DATA_API_KEY");
    return null;
  }

  const url = new URL(path, TWELVE_DATA_BASE);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("apikey", apiKey);

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) {
      console.error(`[TwelveData] HTTP ${res.status} ${res.statusText} for ${params.symbol ?? "unknown-symbol"}`);
      return null;
    }

    return await res.json() as Record<string, unknown>;
  } catch (error) {
    console.error(`[TwelveData] Request failed for ${params.symbol ?? "unknown-symbol"}:`, error);
    return null;
  }
}

function parsePositivePrice(value: unknown) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export async function getTwelveDataQuote(apexSymbol: string) {
  const tdSymbol = getMappedSymbol(apexSymbol);
  if (!tdSymbol) {
    console.error(`[TwelveData] Unsupported symbol mapping for ${apexSymbol}`);
    return null;
  }

  const data = await fetchTwelveDataJson("/price", { symbol: tdSymbol });
  if (!data) {
    console.error(`[TwelveData] Empty price response for ${apexSymbol}`);
    return null;
  }

  if ("code" in data) {
    console.error(`[TwelveData] API error for ${apexSymbol}: ${String(data.message ?? data.code)}`);
    return null;
  }

  const price = parsePositivePrice(data.price);
  if (price == null) {
    console.error(`[TwelveData] Invalid price for ${apexSymbol}: ${JSON.stringify(data).slice(0, 200)}`);
    return null;
  }

  return {
    symbol: apexSymbol,
    price,
    timestamp: Date.now(),
    source: "twelvedata" as const,
  };
}

export async function getTwelveDataBatch(symbols: string[]) {
  const result: Record<string, number | null> = {};

  for (const symbol of symbols) {
    const quote = await getTwelveDataQuote(symbol);
    result[symbol] = quote?.price ?? null;
    await delay(200);
  }

  return result;
}

export async function getTwelveDataTimeSeries(apexSymbol: string, outputsize = 20, interval = "1day") {
  const tdSymbol = getMappedSymbol(apexSymbol);
  if (!tdSymbol) {
    console.error(`[TwelveData] Unsupported time_series mapping for ${apexSymbol}`);
    return null;
  }

  const data = await fetchTwelveDataJson("/time_series", {
    symbol: tdSymbol,
    interval,
    outputsize: String(outputsize),
    format: "JSON",
  });

  if (!data) {
    console.error(`[TwelveData] Empty time_series response for ${apexSymbol}`);
    return null;
  }

  if ("code" in data) {
    console.error(`[TwelveData] API time_series error for ${apexSymbol}: ${String(data.message ?? data.code)}`);
    return null;
  }

  const values = Array.isArray(data.values) ? data.values as Array<Record<string, string>> : [];
  if (values.length === 0) {
    console.error(`[TwelveData] No values returned for ${apexSymbol} time_series`);
    return null;
  }

  return values;
}
