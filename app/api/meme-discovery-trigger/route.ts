import { NextResponse } from "next/server";

import { getMemeUniverse } from "@/src/assets/memecoins/config/memeScope";
import { triggerDiscoveryNow } from "@/src/assets/memecoins/engine/memeRuntime";
import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const auth = await requireOperatorSession();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    await triggerDiscoveryNow();
    const universe = getMemeUniverse();
    return NextResponse.json({
      success: true,
      universeSize: universe.length,
      coins: universe.map(profile => ({
        symbol: profile.symbol,
        displayName: profile.displayName,
        isBase: profile.isBase,
      })),
    });
  } catch (error) {
    console.error("[api/meme-discovery-trigger] Failed to trigger discovery:", error);
    return NextResponse.json(
      {
        error: "Meme coin discovery failed",
      },
      { status: 500 },
    );
  }
}
