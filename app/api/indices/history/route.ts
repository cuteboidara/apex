// app/api/indices/history/route.ts
// GET — persisted signal history from IndicesSignal table

import { NextResponse } from 'next/server';
import { getRecentIndicesSignals } from '@/src/indices/api/persistSignals';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const asset = searchParams.get('asset') ?? undefined;
    const limit = Math.min(200, Number(searchParams.get('limit') ?? '50'));

    const signals = await getRecentIndicesSignals(limit, asset);

    return NextResponse.json({
      ok: true,
      signals,
      count: signals.length,
    });
  } catch (error) {
    console.error('[api/indices/history] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
