// app/api/indices/amt/stats/route.ts
// GET — aggregated paper trading stats from IndicesSignal table

import { NextResponse } from 'next/server';
import { prisma as _prisma } from '@/src/infrastructure/db/prisma';

export const dynamic = 'force-dynamic';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = _prisma as any;

export async function GET() {
  try {
    const signals: {
      totalScore: number;
      assetId: string;
      direction: string;
      smcSetupJson: { setupType?: string } | null;
    }[] = await prisma.indicesSignal.findMany({
      select: {
        totalScore: true,
        assetId: true,
        direction: true,
        smcSetupJson: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const total = signals.length;
    if (total === 0) {
      return NextResponse.json({
        ok: true,
        stats: {
          totalSignals: 0,
          executableSignals: 0,
          watchlistSignals: 0,
          avgScore: 0,
          longPct: 0,
          shortPct: 0,
          byAsset: {},
          bySetup: {},
        },
      });
    }

    const executable = signals.filter(s => s.totalScore >= 60).length;
    const watchlist = signals.filter(s => s.totalScore >= 40 && s.totalScore < 60).length;
    const avgScore = signals.reduce((acc, s) => acc + s.totalScore, 0) / total;
    const longs = signals.filter(s => s.direction === 'long').length;

    const byAsset: Record<string, number> = {};
    const bySetup: Record<string, number> = {};

    for (const s of signals) {
      byAsset[s.assetId] = (byAsset[s.assetId] ?? 0) + 1;
      const setupType = (s.smcSetupJson as { setupType?: string } | null)?.setupType ?? 'unknown';
      bySetup[setupType] = (bySetup[setupType] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      stats: {
        totalSignals: total,
        executableSignals: executable,
        watchlistSignals: watchlist,
        avgScore: Math.round(avgScore * 10) / 10,
        longPct: Math.round((longs / total) * 100),
        shortPct: Math.round(((total - longs) / total) * 100),
        byAsset,
        bySetup,
      },
    });
  } catch (error) {
    console.error('[api/indices/amt/stats] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
