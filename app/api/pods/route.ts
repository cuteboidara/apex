import { NextResponse } from "next/server";

import { getPodsPayload } from "@/src/presentation/api/pods";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getPodsPayload());
  } catch (error) {
    console.error("[pods-route] Failed to serve pods payload:", error);
    return NextResponse.json({ error: "pods_unavailable" }, { status: 503 });
  }
}
