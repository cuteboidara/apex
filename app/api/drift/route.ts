import { NextResponse } from "next/server";

import { getDriftPayload } from "@/src/presentation/api/drift";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getDriftPayload());
  } catch (error) {
    console.error("[drift-route] Failed to serve drift payload:", error);
    return NextResponse.json({ error: "drift_unavailable" }, { status: 503 });
  }
}
