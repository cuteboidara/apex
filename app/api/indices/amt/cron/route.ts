import { NextResponse } from "next/server";
import { runAMTCycle } from "@/src/indices/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handleCron(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

  if (!authHeader || authHeader !== expectedAuth) {
    console.warn("[amt-cron] Unauthorized access attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[amt-cron] Triggered by external cron");
    const result = await runAMTCycle();
    return NextResponse.json({
      success: result.success,
      cycleId: result.cycleId,
      signalsGenerated: result.signals.length,
      executableCount: result.executableCount ?? 0,
      watchlistCount: result.watchlistCount ?? 0,
      session: "scheduled",
      latency: null,
      timestamp: new Date().toISOString(),
      error: result.error,
    });
  } catch (error) {
    console.error("[amt-cron] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return handleCron(req);
}

export async function POST(req: Request) {
  return handleCron(req);
}
