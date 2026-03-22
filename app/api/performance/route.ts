import { NextRequest, NextResponse } from "next/server";
import { buildPerformanceReport, refreshTradePlanDiagnostics } from "@/lib/tradePlanDiagnostics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lookbackDays = Math.max(7, Math.min(180, Number.parseInt(searchParams.get("lookbackDays") ?? "30", 10) || 30));
  const minimumSamples = Math.max(1, Math.min(20, Number.parseInt(searchParams.get("minimumSamples") ?? "3", 10) || 3));

  await refreshTradePlanDiagnostics({ maxPlans: 400 });
  const report = await buildPerformanceReport({ lookbackDays, minimumSamples });

  return NextResponse.json(report);
}
