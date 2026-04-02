import { NextResponse } from "next/server";

import { getValidationDetailPayload } from "@/src/presentation/api/validation";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const payload = await getValidationDetailPayload(id);

    if (!payload.run) {
      return NextResponse.json({ error: "Validation run not found" }, { status: 404 });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[validation-detail-route] Failed to serve validation detail:", error);
    return NextResponse.json({ error: "validation_detail_unavailable" }, { status: 503 });
  }
}
