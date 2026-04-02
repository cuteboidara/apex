import { NextResponse } from "next/server";

import { getCryptoSignalsPayload } from "@/src/crypto/engine/cryptoRuntime";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    return NextResponse.json(getCryptoSignalsPayload());
  } catch (error) {
    console.error("[api/crypto-signals] Failed to read crypto payload:", error);
    return NextResponse.json({
      generatedAt: Date.now(),
      wsConnected: false,
      cycleRunning: false,
      lastCycleAt: null,
      cards: [],
      executable: [],
      monitored: [],
      rejected: [],
      liveMarketBoard: [],
    });
  }
}
