// src/indices/api/persistSignals.ts
// Save ranked signals to the IndicesSignal table via Prisma

import { prisma as _prisma } from '@/src/infrastructure/db/prisma';
import type { RankedSignal } from '@/src/indices/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = _prisma as any; // IndicesSignal/IndicesTrade available after `prisma generate`

export async function persistIndicesSignals(
  cycleId: string,
  signals: RankedSignal[],
): Promise<void> {
  if (signals.length === 0) return;

  await Promise.all(
    signals.map(signal =>
      prisma.indicesSignal.create({
        data: {
          cycleId,
          assetId: signal.assetId,
          assetClass: signal.smcSetup.assetId === 'NAS100' || signal.smcSetup.assetId === 'SPX500' || signal.smcSetup.assetId === 'DAX'
            ? 'index'
            : 'forex',
          direction: signal.direction,
          rank: signal.rank,
          smcScore: signal.scores.smc,
          taScore: signal.scores.ta,
          macroScore: signal.scores.macro,
          quantBonus: signal.scores.quantBonus,
          totalScore: signal.scores.total,
          entryZoneHigh: signal.tradeManagement.entryZone.high,
          entryZoneLow: signal.tradeManagement.entryZone.low,
          entryZoneMid: signal.tradeManagement.entryZone.mid,
          stopLoss: signal.tradeManagement.stopLoss,
          tp1: signal.tradeManagement.takeProfits.tp1.level,
          tp2: signal.tradeManagement.takeProfits.tp2.level,
          tp3: signal.tradeManagement.takeProfits.tp3.level,
          riskRewardRatio: signal.tradeManagement.riskRewardRatio,
          positionSize: signal.positionSize,
          riskAmount: signal.riskAmount,
          historicalWinRate: signal.historicalWinRate,
          expectedValue: signal.quantAnalysis.expectedValue,
          newsRisk: signal.newsRisk,
          reasoning: signal.reasoning,
          macroSummary: signal.macroSummary,
          smcSetupJson: signal.smcSetup as object,
          taConfluenceJson: signal.taConfluence as object,
          macroScoreJson: signal.macroScore as object,
          quantAnalysisJson: signal.quantAnalysis as object,
          correlationsJson: signal.correlations as object,
        },
      }).catch((err: unknown) => {
        console.error(`[indices-persist] Failed to persist signal for ${signal.assetId}:`, err);
      }),
    ),
  );

  console.log(`[indices-persist] Persisted ${signals.length} signals for cycle ${cycleId}`);
}

export async function getRecentIndicesSignals(
  limit = 50,
  assetId?: string,
): Promise<object[]> {
  return prisma.indicesSignal.findMany({
    where: assetId ? { assetId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
