// app/api/indices/macro/route.ts
// GET — current macro context (DXY, VIX, yields, sentiment, calendar)

import { NextResponse } from 'next/server';
import { fetchMacroContext } from '@/src/indices/data/fetchers/macroFetcher';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const macro = await fetchMacroContext();
    return NextResponse.json({ ok: true, macro });
  } catch (error) {
    console.error('[api/indices/macro] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
