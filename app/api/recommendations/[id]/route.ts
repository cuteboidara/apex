import { NextResponse } from "next/server";

import { getRecommendationDetailPayload } from "@/src/presentation/api/recommendations";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const payload = await getRecommendationDetailPayload(id);

    if (!payload.snapshot) {
      return NextResponse.json({ error: "Recommendation snapshot not found" }, { status: 404 });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[recommendation-detail-route] Failed to serve recommendation detail:", error);
    return NextResponse.json({ error: "recommendation_detail_unavailable" }, { status: 503 });
  }
}
