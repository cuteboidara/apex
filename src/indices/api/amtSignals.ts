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

// ─── Asset State (scan tracking) ──────────────────────────────────────────

/**
 * Upsert a scan-state record for every asset processed in a cycle —
 * whether or not a qualifying signal was found.
 */
export async function persistAssetStates(
  cycleId: string,
  states: Array<{ assetId: string; lastPrice: number; hasSignal: boolean }>,
): Promise<void> {
  if (states.length === 0) return;

  await Promise.all(
    states.map(state =>
      prisma.indicesAssetState
        .upsert({
          where: { assetId: state.assetId },
          update: {
            lastScanned: new Date(),
            lastPrice: state.lastPrice,
            hasSignal: state.hasSignal,
            cycleId,
          },
          create: {
            assetId: state.assetId,
            lastScanned: new Date(),
            lastPrice: state.lastPrice,
            hasSignal: state.hasSignal,
            cycleId,
          },
        })
        .catch((err: unknown) => {
          console.error(`[amt-persist] Asset state upsert failed for ${state.assetId}:`, err);
        }),
    ),
  );

  console.log(`[amt-persist] Asset states updated for ${states.length} assets (cycle ${cycleId})`);
}

export async function getAssetStates(): Promise<object[]> {
  try {
    return await prisma.indicesAssetState.findMany({
      orderBy: { lastScanned: 'desc' },
    });
  } catch {
    // Table may not exist yet if migration hasn't been run
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function resolveAssetClass(assetId: string): string {
  const config = (ASSET_CONFIG as Record<string, { assetClass: string }>)[assetId];
  return config?.assetClass ?? 'other';
}
