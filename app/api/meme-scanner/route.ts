import { NextResponse } from "next/server";

import { getMemeScannerPayload } from "@/src/assets/memecoins/intelligence/memeScanner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    return NextResponse.json(await getMemeScannerPayload());
  } catch (error) {
    console.error("[api/meme-scanner] Failed to build scanner payload:", error);
    return NextResponse.json(
      {
        generatedAt: Date.now(),
        alertsSent: 0,
        coins: [],
      },
      { status: 200 },
    );
  }
}
