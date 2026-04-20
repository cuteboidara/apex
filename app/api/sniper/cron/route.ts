import { NextResponse } from "next/server";
import { runSniperCycle } from "@/src/sniper/runtime";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handleCron(req: Request) {
  const authHeader = req.headers.get("authorization");
  const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;

  if (!authHeader || authHeader !== expectedAuth) {
    console.warn("[sniper-cron] Unauthorized access attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[sniper-cron] Triggered by external cron");
    const result = await runSniperCycle();
    return NextResponse.json({
      success: true,
      cycleId: `sniper-${Date.now()}`,
      signalsGenerated: result.signals.length,
      session: result.session,
      latency: result.latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[sniper-cron] Error:", error);
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
