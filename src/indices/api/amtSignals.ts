// src/indices/api/amtSignals.ts
// Persist and retrieve AMT signals from the database

import { prisma as _prisma } from '@/src/infrastructure/db/prisma';
import type { AMTSignal, AMTCycleResult } from '@/src/indices/types/amtTypes';
import { ASSET_CONFIG } from '@/src/indices/data/fetchers/assetConfig';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = _prisma as any; // IndicesSignal available after `prisma generate`

// ─── Persist ──────────────────────────────────────────────────────────────

/**
 * Persist AMT signals from a completed cycle into IndicesSignal.
 * Maps AMT fields onto the existing IndicesSignal schema.
 */
export async function persistAMTSignals(
  cycleResult: AMTCycleResult,
): Promise<void> {
  const { signals, cycleId } = cycleResult;
  if (signals.length === 0) return;

  await Promise.all(
    signals.map(signal =>
      prisma.indicesSignal
        .create({
          data: {
            cycleId,
            assetId: signal.assetId,
            assetClass: resolveAssetClass(signal.assetId),
            direction: signal.direction,
            rank: signal.rank,

            // AMT scores mapped to existing columns
            smcScore: signal.smcTaAlignment,       // SMC/TA alignment (0–20)
            taScore: signal.candleQuality,          // candle quality (0–25)
            macroScore: signal.macroAdjustment,     // macro adj (−20 to +20)
            quantBonus: signal.correlationBonus,    // correlation bonus (0–10)
            totalScore: signal.totalScore,

            // Entry / risk
            entryZoneHigh: signal.entryZone.high,
            entryZoneLow: signal.entryZone.low,
            entryZoneMid: signal.entryZone.mid,
            stopLoss: signal.stopLoss,
            tp1: signal.tp1,
            tp2: signal.tp2,
            tp3: signal.tp3,
            riskRewardRatio: signal.riskRewardRatio,
            positionSize: signal.positionSize,
            riskAmount: signal.riskAmount,
            historicalWinRate: null,
            expectedValue: null,

            // Meta
            newsRisk: signal.newsRisk,
            reasoning: signal.setupDescription,
            macroSummary: signal.macroContext,

            // JSON blobs
            smcSetupJson: {
              setupType: signal.setupType,
              orderFlowConfirmation: signal.orderFlowConfirmation,
            } as object,
            taConfluenceJson: {
              patterns: signal.patterns,
              confirmationCandles: signal.confirmationCandles,
            } as object,
            macroScoreJson: signal.regime as object,
            quantAnalysisJson: {
              kellyFraction: signal.kellyFraction,
            } as object,
            correlationsJson: null,

            sentTelegram: false,
          },
        })
        .catch((err: unknown) => {
          console.error(`[amt-persist] Failed for ${signal.assetId}:`, err);
        }),
    ),
  );

  console.log(`[amt-persist] Persisted ${signals.length} AMT signals for cycle ${cycleId}`);
}

// ─── Read ─────────────────────────────────────────────────────────────────

export async function getRecentAMTSignals(
  limit = 20,
  assetId?: string,
): Promise<object[]> {
  return prisma.indicesSignal.findMany({
    where: assetId ? { assetId } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getLatestAMTCycle(): Promise<{
  cycleId: string | null;
  signals: object[];
}> {
  const latest = await prisma.indicesSignal.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { cycleId: true },
  });

  if (!latest) return { cycleId: null, signals: [] };

  const signals = await prisma.indicesSignal.findMany({
    where: { cycleId: latest.cycleId },
    orderBy: { rank: 'asc' },
  });

  return { cycleId: latest.cycleId, signals };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function resolveAssetClass(assetId: string): string {
  const config = (ASSET_CONFIG as Record<string, { assetClass: string }>)[assetId];
  return config?.assetClass ?? 'other';
}
