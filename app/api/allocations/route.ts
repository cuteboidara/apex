import { NextResponse } from "next/server";

import { getAllocationsPayload } from "@/src/presentation/api/allocations";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getAllocationsPayload());
  } catch (error) {
    console.error("[allocations-route] Failed to serve allocations:", error);
    return NextResponse.json({ error: "allocations_unavailable" }, { status: 503 });
  }
}
