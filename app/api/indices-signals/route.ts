import { NextResponse } from "next/server";

import { getIndicesSignalsPayload } from "@/src/assets/indices/engine/indicesRuntime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    return NextResponse.json(getIndicesSignalsPayload());
  } catch (error) {
    console.error("[api/indices-signals] Failed to read indices payload:", error);
    return NextResponse.json({
      enabled: true,
      generatedAt: Date.now(),
      lastCycleAt: null,
      cycleRunning: false,
      providerName: "Stooq / Yahoo",
      providerStatus: "no_data",
      providerNotice: "Index data is currently unavailable from the free benchmark feeds.",
      cards: [],
      executable: [],
      monitored: [],
      rejected: [],
      liveMarketBoard: [],
    });
  }
}
