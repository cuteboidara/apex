import type { COTReport } from "@/src/smc/types";

const COT_URL = "https://www.cftc.gov/dea/newcot/FinFutWk.txt";

const SYMBOL_TO_COT_NAME: Record<string, string> = {
  EURUSD: "EURO FX",
  GBPUSD: "BRITISH POUND",
  USDJPY: "JAPANESE YEN",
  EURJPY: "EURO FX",
  AUDUSD: "AUSTRALIAN DOLLAR",
  NZDUSD: "NEW ZEALAND DOLLAR",
};

const COT_CACHE_TTL_MS = 24 * 60 * 60_000;
const COT_FETCH_TIMEOUT_MS = 1_500;
const COT_FAILURE_COOLDOWN_MS = 30 * 60_000;

let cotCache: { data: COTReport[]; fetchedAt: number } | null = null;
let refreshPromise: Promise<COTReport[]> | null = null;
let lastFetchAttemptAt = 0;
let cotFailureCooldownUntil = 0;

function shouldAutoPrime(): boolean {
  return !(process.env.NODE_ENV === "test" || process.argv.includes("--test"));
}

function shouldRefreshCache(): boolean {
  if (Date.now() < cotFailureCooldownUntil) {
    return false;
  }
  return !cotCache || (Date.now() - cotCache.fetchedAt) >= COT_CACHE_TTL_MS;
}

function parseInteger(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const normalized = value.replaceAll(",", "").trim();
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function deriveBias(net: number): COTReport["smartMoneyBias"] {
  if (net > 5_000) {
    return "bullish";
  }
  if (net < -5_000) {
    return "bearish";
  }
  return "neutral";
}

function deriveStrength(net: number): COTReport["smartMoneyBiasStrength"] {
  const absolute = Math.abs(net);
  if (absolute > 50_000) {
    return "strong";
  }
  if (absolute > 20_000) {
    return "moderate";
  }
  return "weak";
}

function parseCOTText(text: string): COTReport[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  const reports: COTReport[] = [];

  for (const line of lines) {
    const fields = line.split(",").map(field => field.trim().replaceAll("\"", ""));
    if (fields.length < 20) {
      continue;
    }

    const contractName = fields[0]?.toUpperCase() ?? "";
    const reportDate = fields[2] ?? "";
    const symbol = Object.entries(SYMBOL_TO_COT_NAME).find(([, name]) => contractName.includes(name))?.[0];
    if (!symbol) {
      continue;
    }

    const commercialLong = parseInteger(fields[5]);
    const commercialShort = parseInteger(fields[6]);
    const nonCommercialLong = parseInteger(fields[8]);
    const nonCommercialShort = parseInteger(fields[9]);
    const retailLong = parseInteger(fields[11]);
    const retailShort = parseInteger(fields[12]);
    const nonCommercialNet = nonCommercialLong - nonCommercialShort;
    const retailNet = retailLong - retailShort;

    reports.push({
      symbol,
      reportDate,
      commercialLong,
      commercialShort,
      commercialNet: commercialLong - commercialShort,
      nonCommercialLong,
      nonCommercialShort,
      nonCommercialNet,
      retailLong,
      retailShort,
      retailNet,
      smartMoneyBias: deriveBias(nonCommercialNet),
      smartMoneyBiasStrength: deriveStrength(nonCommercialNet),
      weeklyChange: 0,
      divergence: (nonCommercialNet > 0 && retailNet < 0) || (nonCommercialNet < 0 && retailNet > 0),
    });
  }

  return reports;
}

async function refreshCOTData(force = false): Promise<COTReport[]> {
  if (!force && !shouldRefreshCache() && cotCache) {
    return cotCache.data;
  }

  if (refreshPromise) {
    return refreshPromise;
  }

  lastFetchAttemptAt = Date.now();
  refreshPromise = (async () => {
    try {
      const response = await fetch(COT_URL, {
        headers: {
          "User-Agent": "APEX-Intelligence/1.0",
        },
        signal: AbortSignal.timeout(COT_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`COT fetch failed: ${response.status}`);
      }

      const text = await response.text();
      const data = parseCOTText(text);
      cotCache = {
        data,
        fetchedAt: Date.now(),
      };
      return data;
    } catch (error) {
      cotFailureCooldownUntil = Date.now() + COT_FAILURE_COOLDOWN_MS;
      console.error("[smc/cot] Failed to fetch COT data:", error instanceof Error ? error.message : String(error));
      return cotCache?.data ?? [];
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function fetchCOTData(): Promise<COTReport[]> {
  return refreshCOTData(true);
}

export function primeCOTData(): void {
  if (!shouldAutoPrime()) {
    return;
  }
  if (refreshPromise) {
    return;
  }
  if (!shouldRefreshCache() || (Date.now() - lastFetchAttemptAt) < COT_FETCH_TIMEOUT_MS) {
    return;
  }
  void refreshCOTData(false);
}

export function peekCOTForSymbol(symbol: string): COTReport | null {
  if (shouldAutoPrime() && shouldRefreshCache() && !refreshPromise && (Date.now() - lastFetchAttemptAt) >= COT_FETCH_TIMEOUT_MS) {
    primeCOTData();
  }
  return cotCache?.data.find(report => report.symbol === symbol) ?? null;
}

export async function getCOTForSymbol(symbol: string): Promise<COTReport | null> {
  const data = await refreshCOTData(false);
  return data.find(report => report.symbol === symbol) ?? null;
}

export function scoreCOT(cot: COTReport | null, direction: "buy" | "sell" | "neutral"): number {
  if (!cot || direction === "neutral") {
    return 0;
  }

  const aligned = (direction === "buy" && cot.smartMoneyBias === "bullish")
    || (direction === "sell" && cot.smartMoneyBias === "bearish");
  if (!aligned && cot.smartMoneyBias !== "neutral") {
    return 0;
  }
  if (cot.smartMoneyBias === "neutral") {
    return 4;
  }
  return cot.smartMoneyBiasStrength === "strong" ? 10 : cot.smartMoneyBiasStrength === "moderate" ? 7 : 4;
}
