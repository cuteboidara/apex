import { NextResponse } from "next/server";

import { triggerCommoditiesCycle } from "@/src/assets/commodities/engine/commoditiesRuntime";
import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const auth = await requireOperatorSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await triggerCommoditiesCycle();
    return NextResponse.json({
      queued: false,
      triggered: true,
      status: "completed",
      ...result,
    });
  } catch (error) {
    console.error("[api/commodities-cycle-trigger] Failed to trigger commodities cycle:", error);
    return NextResponse.json(
      {
        error: "Commodities cycle trigger failed",
      },
      { status: 500 },
    );
  }
}
