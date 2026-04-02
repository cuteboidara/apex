import { NextResponse } from "next/server";

import { triggerIndicesCycle } from "@/src/assets/indices/engine/indicesRuntime";
import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const auth = await requireOperatorSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await triggerIndicesCycle();
    return NextResponse.json({
      queued: false,
      triggered: true,
      status: "completed",
      ...result,
    });
  } catch (error) {
    console.error("[api/indices-cycle-trigger] Failed to trigger indices cycle:", error);
    return NextResponse.json(
      {
        error: "Indices cycle trigger failed",
      },
      { status: 500 },
    );
  }
}
