import { NextResponse } from "next/server";
import { getSchedulerHeartbeat } from "@/src/lib/schedulerHeartbeat";

export const dynamic = "force-dynamic";

export async function GET() {
  const scheduler = await getSchedulerHeartbeat();
  return NextResponse.json({
    ok: true,
    service: "apex-web",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    scheduler: {
      mode: scheduler?.mode ?? "manual",
      lastRunAt: scheduler?.lastRunAt ?? null,
      nextRunAt: scheduler?.nextRunAt ?? null,
      startedAt: scheduler?.startedAt ?? null,
      intervalMinutes: scheduler?.intervalMinutes ?? null,
      lastSource: scheduler?.lastSource ?? null,
    },
  });
}
