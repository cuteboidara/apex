import { NextResponse } from "next/server";

import { getMemeTrendRadarPayload } from "@/src/assets/memecoins/intelligence/memeTrends";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    return NextResponse.json(await getMemeTrendRadarPayload());
  } catch (error) {
    console.error("[api/meme-trends] Failed to build trend radar payload:", error);
    return NextResponse.json(
      {
        generatedAt: Date.now(),
        trends: [],
      },
      { status: 200 },
    );
  }
}
