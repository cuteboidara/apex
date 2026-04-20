import { NextResponse } from "next/server";

import { listSniperAssetStates } from "@/src/sniper/api/sniperSignals";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const states = await listSniperAssetStates();
    return NextResponse.json(states);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

