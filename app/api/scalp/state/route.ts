import { NextResponse } from "next/server";
import { listScalpAssetStates } from "@/src/scalp/api/scalpSignals";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const states = await listScalpAssetStates();
    return NextResponse.json(states);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
