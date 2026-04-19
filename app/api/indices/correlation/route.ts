// app/api/indices/correlation/route.ts
// GET — correlation matrix between all 7 assets

import { NextResponse } from 'next/server';
import { getCache, CacheKeys } from '@/src/indices/data/cache/cacheManager';
import type { CorrelationPair } from '@/src/indices/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const pairs = await getCache<CorrelationPair[]>(CacheKeys.correlations());
    if (!pairs) {
      return NextResponse.json({
        ok: true,
        pairs: [],
        message: 'No correlation data yet — trigger a cycle first',
      });
    }
    return NextResponse.json({ ok: true, pairs, count: pairs.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
