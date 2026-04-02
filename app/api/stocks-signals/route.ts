import { NextResponse } from "next/server";

import { getStocksSignalsPayload } from "@/src/assets/stocks/engine/stocksRuntime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    return NextResponse.json(getStocksSignalsPayload());
  } catch (error) {
    console.error("[api/stocks-signals] Failed to read stocks payload:", error);
    return NextResponse.json({
      enabled: true,
      generatedAt: Date.now(),
      lastCycleAt: null,
      cycleRunning: false,
      providerName: "Yahoo",
      providerStatus: "broken",
      providerNotice: "Stocks payload failed to load from Yahoo Finance.",
      cards: [],
      executable: [],
      monitored: [],
      rejected: [],
      liveMarketBoard: [],
    });
  }
}
