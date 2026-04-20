import { NextResponse } from "next/server";

import { calculateScalpStats, listActiveScalpSignals, listClosedScalpSignals } from "@/src/scalp/api/scalpSignals";
import { getCurrentSession } from "@/src/scalp/data/fetchers/sessionDetector";

const SCALP_ENGINE_VERSION = "SCALP_V3_5GATE";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [active, recent, stats] = await Promise.all([
      listActiveScalpSignals(),
      listClosedScalpSignals(20),
      calculateScalpStats(),
    ]);

    return NextResponse.json({
      active,
      recent,
      stats: {
        ...stats,
        engine: SCALP_ENGINE_VERSION,
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
