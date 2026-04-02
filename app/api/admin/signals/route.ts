import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/requireAdmin";
import { getSignalsPayload } from "@/src/presentation/api/signals";

export const dynamic = "force-dynamic";

function applyFilters<T extends { symbol: string; grade: string }>(
  items: T[],
  filters: { asset: string | null; rank: string | null; limit: number },
): T[] {
  return items
    .filter(item => (filters.asset ? item.symbol === filters.asset : true))
    .filter(item => (filters.rank ? item.grade === filters.rank : true))
    .slice(0, filters.limit);
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const filters = {
    asset: searchParams.get("asset"),
    rank: searchParams.get("rank"),
    limit: Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 200),
  };

  const payload = await getSignalsPayload();

  return NextResponse.json({
    generatedAt: payload.generatedAt,
    pipelineDiagnostics: payload.pipelineDiagnostics ?? null,
    executable: applyFilters(payload.executable, filters),
    monitored: applyFilters(payload.monitored, filters),
    rejected: applyFilters(payload.rejected, filters),
  });
}
