import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ signalId: string }> },
) {
  const { signalId } = await params;

  try {
    const reasoning = await prisma.signalReasoning.findUnique({
      where: { signalId },
      include: {
        signal: true,
      },
    });

    if (!reasoning) {
      return NextResponse.json({ error: 'No reasoning found' }, { status: 404 });
    }

    return NextResponse.json({
      signal: reasoning.signal,
      analyst: reasoning.analystOutput,
      risk: reasoning.riskOutput,
      macro: reasoning.macroOutput,
      decision: reasoning.decisionOutput,
      metrics: {
        latencyMs: reasoning.totalLatencyMs,
        tokensUsed: reasoning.totalTokensUsed,
        costUsd: reasoning.totalCostUsd,
      },
    });
  } catch (error) {
    console.error('[api/indices/amt/reasoning] Failed:', error);
    return NextResponse.json({ error: 'Failed to fetch reasoning' }, { status: 500 });
  }
}
