import { NextResponse } from "next/server";
import { fetchLiveMarketPrices } from "@/lib/liveMarket";

export async function GET() {
  const prices = await fetchLiveMarketPrices();
  return NextResponse.json({
    assets: prices.map(price => ({
      symbol: price.symbol,
      assetClass: price.assetClass,
      marketStatus: price.marketStatus,
      stale: price.stale,
      selectedProvider: price.selectedProvider,
      fallbackUsed: price.fallbackUsed,
      freshnessMs: price.freshnessMs,
      styleReadiness: price.styleReadiness,
      reason: price.reason,
    })),
    timestamp: new Date().toISOString(),
  });
}
