import { NextRequest, NextResponse } from "next/server";
import { SUPPORTED_ASSETS } from "@/lib/assets";
import { orchestrateCandles } from "@/lib/marketData/candleOrchestrator";
import { fetchMarketCandles } from "@/lib/marketData/fetchCandles";

export const dynamic = "force-dynamic";
import type { Timeframe } from "@/lib/marketData/types";

const SUPPORTED_TIMEFRAMES = new Set<Timeframe>(["1m", "5m", "15m", "1h", "4h", "1D"]);

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const symbol    = searchParams.get("symbol")?.toUpperCase() ?? "";
  const timeframe = searchParams.get("timeframe") as Timeframe | null;
  const limit     = Math.min(200, Math.max(1, Number.parseInt(searchParams.get("limit") ?? "80", 10) || 80));
  const from      = parseTimestamp(searchParams.get("from"));
  const to        = parseTimestamp(searchParams.get("to"));

  if (!symbol) {
    return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
  }

  if (!timeframe || !SUPPORTED_TIMEFRAMES.has(timeframe)) {
    return NextResponse.json({ error: "Unsupported timeframe" }, { status: 400 });
  }

  const asset = SUPPORTED_ASSETS.find(candidate => candidate.symbol === symbol);
  if (!asset) {
    return NextResponse.json({ error: "Unsupported symbol" }, { status: 400 });
  }

  let result: {
    candles:             Array<{ timestamp: number; open: number | null; high: number | null; low: number | null; close: number | null; volume: number | null }>;
    selectedProvider:    string | null;
    provider:            string;
    fallbackUsed:        boolean;
    freshnessMs:         number | null;
    freshnessClass?:     string;
    marketStatus:        "LIVE" | "DEGRADED" | "UNAVAILABLE";
    degraded?:           boolean;
    stale?:              boolean;
    reason:              string | null;
    circuitState?:       string | null;
    providerHealthScore?: number | null;
    sourceType?:         string;
    fromCache?:          boolean;
    priority?:           string;
  };

  if (asset.assetClass === "FOREX" || asset.assetClass === "COMMODITY") {
    result = await fetchMarketCandles(symbol, asset.assetClass, timeframe);
  } else {
    result = await orchestrateCandles(symbol, asset.assetClass, timeframe, {
      consumer: "chart",
      priority: "hot",
    });
  }

  const rangedCandles = result.candles.filter(candle => {
    if (from != null && candle.timestamp < from) return false;
    if (to   != null && candle.timestamp > to)   return false;
    return true;
  });
  const candles = rangedCandles.slice(-limit);

  return NextResponse.json({
    symbol,
    assetClass:          asset.assetClass,
    timeframe,
    candles,
    selectedProvider:    result.selectedProvider ?? result.provider,
    provider:            result.provider,
    fallbackUsed:        result.fallbackUsed,
    freshnessMs:         result.freshnessMs,
    freshnessClass:      result.freshnessClass ?? null,
    marketStatus:        result.marketStatus,
    degraded:            result.degraded ?? false,
    stale:               result.stale ?? false,
    reason:              result.reason,
    circuitState:        result.circuitState ?? null,
    providerHealthScore: result.providerHealthScore ?? null,
    sourceType:          result.sourceType ?? null,
    fromCache:           result.fromCache ?? false,
    priority:            result.priority ?? "hot",
    requestedLimit:      limit,
    range: { from, to },
  });
}
