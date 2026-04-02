import { NextResponse } from "next/server";

import { getRiskDecisionsPayload } from "@/src/presentation/api/risk";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getRiskDecisionsPayload());
  } catch (error) {
    console.error("[risk-route] Failed to serve risk decisions:", error);
    return NextResponse.json({ error: "risk_unavailable" }, { status: 503 });
  }
}
