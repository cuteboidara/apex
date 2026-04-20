import { NextResponse } from "next/server";

import { calculateSniperStats, listActiveSniperSignals, listRecentClosedSniperSignals } from "@/src/sniper/api/sniperSignals";
import { getCurrentSession } from "@/src/sniper/data/fetchers/sessionDetector";

const SNIPER_ENGINE_VERSION = "SNIPER_V2_SWEEP_BOS";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [active, recent, stats] = await Promise.all([
      listActiveSniperSignals(),
      listRecentClosedSniperSignals(20),
      calculateSniperStats(),
    ]);

    return NextResponse.json({
      active,
      recent,
      stats: {
        ...stats,
        engine: SNIPER_ENGINE_VERSION,
        currentSession: getCurrentSession(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
