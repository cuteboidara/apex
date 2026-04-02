import { NextResponse } from "next/server";

import {
  generateRecommendationSnapshotPayload,
  getRecommendationQueuePayload,
} from "@/src/presentation/api/recommendations";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getRecommendationQueuePayload());
  } catch (error) {
    console.error("[recommendations-route] Failed to serve recommendation queue:", error);
    return NextResponse.json({ error: "recommendations_unavailable" }, { status: 503 });
  }
}

export async function POST() {
  try {
    return NextResponse.json(await generateRecommendationSnapshotPayload());
  } catch (error) {
    console.error("[recommendations-route] Failed to generate recommendation snapshot:", error);
    return NextResponse.json({ error: "recommendation_generation_failed" }, { status: 500 });
  }
}
