import { NextResponse } from "next/server";

import { calculateSniperStats, listActiveSniperSignals, listRecentClosedSniperSignals } from "@/src/sniper/api/sniperSignals";
import { getCurrentSession } from "@/src/sniper/data/fetchers/sessionDetector";

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

