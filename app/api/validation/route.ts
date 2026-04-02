import { NextResponse } from "next/server";

import {
  generateValidationRunPayload,
  getValidationQueuePayload,
  refreshValidationAlphaAnalytics,
} from "@/src/presentation/api/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getValidationQueuePayload());
  } catch (error) {
    console.error("[validation-route] Failed to serve validation queue:", error);
    return NextResponse.json({ error: "validation_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { action?: string } | null;
    if (body?.action === "refresh_alpha_analytics") {
      return NextResponse.json(await refreshValidationAlphaAnalytics());
    }

    return NextResponse.json(await generateValidationRunPayload());
  } catch (error) {
    console.error("[validation-route] Failed to generate validation run:", error);
    return NextResponse.json({ error: "validation_run_failed" }, { status: 500 });
  }
}
