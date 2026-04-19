// app/api/indices/amt/macro/route.ts
// GET — live macro context (DXY, VIX, yield, sentiment, calendar)

import { NextResponse } from 'next/server';
import { fetchMacroContext } from '@/src/indices/data/fetchers/macroFetcher';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const macro = await fetchMacroContext();
    return NextResponse.json({ ok: true, macro });
  } catch (error) {
    console.error('[api/indices/amt/macro] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
