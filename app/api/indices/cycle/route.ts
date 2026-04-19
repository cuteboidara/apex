// app/api/indices/cycle/route.ts
// POST — trigger a manual indices scan cycle

import { NextResponse } from 'next/server';
import { triggerIndicesCycle } from '@/src/indices/indicesRuntime';
import { persistIndicesSignals } from '@/src/indices/api/persistSignals';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const result = await triggerIndicesCycle({
      accountSize: body.accountSize,
      riskPct: body.riskPct,
      minScore: body.minScore,
    });

    // Persist to DB
    if (result.signals.length > 0) {
      await persistIndicesSignals(result.cycleId, result.signals).catch(err => {
        console.error('[api/indices/cycle] Persist failed:', err);
      });
    }

    return NextResponse.json({
      ok: true,
      cycleId: result.cycleId,
      signalCount: result.signalCount,
      signals: result.signals,
    });
  } catch (error) {
    console.error('[api/indices/cycle] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  try {
    const { getIndicesRuntimeStatus } = await import('@/src/indices/indicesRuntime');
    return NextResponse.json({ ok: true, status: getIndicesRuntimeStatus() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
