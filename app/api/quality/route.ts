import { NextRequest, NextResponse } from "next/server";

import { getSignalQualityPayload } from "@/src/presentation/api/quality";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    return NextResponse.json(await getSignalQualityPayload({
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
    }));
  } catch (error) {
    console.error("[quality-route] Failed to serve quality payload:", error);
    return NextResponse.json({ error: "quality_unavailable" }, { status: 503 });
  }
}
