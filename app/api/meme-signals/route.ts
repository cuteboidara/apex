import { NextResponse } from "next/server";

import { getMemeSignalsPayload } from "@/src/assets/memecoins/engine/memeRuntime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    return NextResponse.json(getMemeSignalsPayload());
  } catch (error) {
    console.error("[api/meme-signals] Failed to read meme payload:", error);
    return NextResponse.json({
      generatedAt: Date.now(),
      lastCycleAt: null,
      lastDiscoveryAt: null,
      cardCount: 0,
      cycleRunning: false,
      discoveryRunning: false,
      wsConnected: false,
      universeSize: 0,
      universe: [],
      cards: [],
      executable: [],
      monitored: [],
      rejected: [],
      liveMarketBoard: [],
    });
  }
}
