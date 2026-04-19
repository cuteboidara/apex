// app/api/indices/amt/cycle/route.ts
// POST — trigger AMT scan cycle | GET — status

import { NextResponse } from 'next/server';
import { runAMTCycle, getAMTRuntimeStatus } from '@/src/indices/runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST() {
  try {
    const result = await runAMTCycle();

    return NextResponse.json({
      ok: result.success,
      cycleId: result.cycleId,
      executableCount: result.executableCount,
      watchlistCount: result.watchlistCount,
      error: result.error,
    });
  } catch (error) {
    console.error('[api/indices/amt/cycle] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, status: getAMTRuntimeStatus() });
}
