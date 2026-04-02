import { NextResponse } from "next/server";

import { triggerStocksCycle } from "@/src/assets/stocks/engine/stocksRuntime";
import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const auth = await requireOperatorSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await triggerStocksCycle();
    return NextResponse.json({
      queued: false,
      triggered: true,
      status: "completed",
      ...result,
    });
  } catch (error) {
    console.error("[api/stocks-cycle-trigger] Failed to trigger stocks cycle:", error);
    return NextResponse.json(
      {
        error: "Stocks cycle trigger failed",
      },
      { status: 500 },
    );
  }
}
