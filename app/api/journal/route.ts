import { NextRequest, NextResponse } from "next/server";

import { getJournalPayload } from "@/src/presentation/api/journal";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const limit = searchParams.get("limit");
    return NextResponse.json(await getJournalPayload({
      symbol: searchParams.get("symbol") ?? undefined,
      action: (searchParams.get("action") as "executed" | "rejected" | "deferred" | "halted" | null) ?? undefined,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      limit: limit ? Number(limit) : undefined,
    }));
  } catch (error) {
    console.error("[journal-route] Failed to serve journal payload:", error);
    return NextResponse.json({ error: "journal_unavailable" }, { status: 503 });
  }
}
