import { NextRequest, NextResponse } from "next/server";

import { reviewRecommendationProposalPayload } from "@/src/presentation/api/recommendations";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as {
      pair?: string;
      action?: "approve" | "reject";
    };

    if (!body.pair || (body.action !== "approve" && body.action !== "reject")) {
      return NextResponse.json({ error: "Invalid recommendation review payload" }, { status: 400 });
    }

    const payload = await reviewRecommendationProposalPayload({
      snapshotId: id,
      pair: body.pair,
      action: body.action,
    });

    if (!payload) {
      return NextResponse.json({ error: "Recommendation proposal not found or no longer reviewable" }, { status: 404 });
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[recommendation-review-route] Failed to review recommendation:", error);
    return NextResponse.json({ error: "recommendation_review_failed" }, { status: 500 });
  }
}
