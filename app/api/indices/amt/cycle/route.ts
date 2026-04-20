// app/api/indices/amt/cycle/route.ts
// POST — trigger AMT scan cycle | GET — status

import { NextResponse } from 'next/server';
import { runAMTCycle, getAMTRuntimeStatus } from '@/src/indices/runtime';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

type CycleRequestPayload = {
  quick?: boolean;
  skipReasoning?: boolean;
  skipTelegram?: boolean;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as CycleRequestPayload;
    const quickMode = body.quick === true;

    const result = await runAMTCycle({
      skipReasoning: body.skipReasoning ?? quickMode,
      skipTelegram: body.skipTelegram ?? quickMode,
    });

    return NextResponse.json({
      ok: result.success,
      cycleId: result.cycleId,
      executableCount: result.executableCount,
      watchlistCount: result.watchlistCount,
      error: result.error,
      mode: quickMode ? 'quick' : 'full',
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
