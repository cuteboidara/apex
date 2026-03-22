import { NextResponse } from "next/server";
import { fetchLiveMarketPrices } from "@/lib/liveMarket";

export const dynamic = "force-dynamic";

export async function GET() {
  const prices = await fetchLiveMarketPrices();
  return NextResponse.json({
    assets: prices.map((price: (typeof prices)[number]) => ({
      symbol: price.symbol,
      assetClass: price.assetClass,
      marketStatus: price.marketStatus,
      stale: price.stale,
      selectedProvider: price.selectedProvider,
      fallbackUsed: price.fallbackUsed,
      freshnessMs: price.freshnessMs,
      freshnessClass: "freshnessClass" in price ? price.freshnessClass : null,
      sourceType: "sourceType" in price ? price.sourceType : null,
      providerHealthScore: "providerHealthScore" in price ? price.providerHealthScore : null,
      degraded: price.degraded,
      candleProviders: "candleProviders" in price ? price.candleProviders : null,
      styleReadiness: price.styleReadiness,
      reason: price.reason,
    })),
    timestamp: new Date().toISOString(),
  });
}
