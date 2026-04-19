// app/api/indices/amt/signals/route.ts
// GET — latest AMT signals from DB

import { NextResponse } from 'next/server';
import { getLatestAMTCycle, getRecentAMTSignals } from '@/src/indices/api/amtSignals';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const assetId = url.searchParams.get('asset') ?? undefined;
    const limit = Number(url.searchParams.get('limit') ?? '20');

    const [latest, recent] = await Promise.all([
      getLatestAMTCycle(),
      getRecentAMTSignals(limit, assetId),
    ]);

    return NextResponse.json({
      ok: true,
      cycleId: latest.cycleId,
      signals: latest.signals,
      recent,
    });
  } catch (error) {
    console.error('[api/indices/amt/signals] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
