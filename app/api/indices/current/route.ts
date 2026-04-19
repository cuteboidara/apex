// app/api/indices/current/route.ts
// GET — current in-memory ranked signals from the indices engine

import { NextResponse } from 'next/server';
import { getLatestIndicesSignals, getIndicesRuntimeStatus } from '@/src/indices/indicesRuntime';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const asset = searchParams.get('asset') ?? undefined;
    const minScore = Number(searchParams.get('minScore') ?? '0');

    const signals = getLatestIndicesSignals();
    const status = getIndicesRuntimeStatus();

    const filtered = signals.filter(s =>
      (!asset || s.assetId === asset) &&
      s.scores.total >= minScore,
    );

    return NextResponse.json({
      ok: true,
      status,
      signals: filtered,
      executable: filtered.filter(s => s.scores.total >= 60),
      watchlist: filtered.filter(s => s.scores.total < 60),
      count: filtered.length,
    });
  } catch (error) {
    console.error('[api/indices/current] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
