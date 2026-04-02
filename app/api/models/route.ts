import { NextResponse } from "next/server";

import { getModelsPayload } from "@/src/presentation/api/models";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getModelsPayload());
  } catch (error) {
    console.error("[models-route] Failed to serve models payload:", error);
    return NextResponse.json({ error: "models_unavailable" }, { status: 503 });
  }
}
