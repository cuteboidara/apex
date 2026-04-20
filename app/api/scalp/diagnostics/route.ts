import { NextResponse } from "next/server";
import { listScalpDiagnostics } from "@/src/scalp/api/scalpSignals";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cycles = await listScalpDiagnostics(20);
    return NextResponse.json({ cycles });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
