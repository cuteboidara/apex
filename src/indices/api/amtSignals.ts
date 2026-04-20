// src/indices/api/amtSignals.ts
// Persist and retrieve AMT signals from the database

import { prisma as _prisma } from '@/src/infrastructure/db/prisma';
import type { AMTSignal, AMTCycleResult } from '@/src/indices/types/amtTypes';
import { ASSET_CONFIG } from '@/src/indices/data/fetchers/assetConfig';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = _prisma as any; // IndicesSignal available after `prisma generate`

function asFinite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function asFiniteNullable(value: number | null | undefined): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? value : null;
}

function toJsonSafe<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, raw) => {
      if (typeof raw === 'number' && !Number.isFinite(raw)) {
        return null;
      }
      return raw;
    }),
  ) as T;
}

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
            smcScore: asFinite(signal.smcTaAlignment),       // SMC/TA alignment (0–20)
            taScore: asFinite(signal.candleQuality),          // candle quality (0–25)
            macroScore: asFinite(signal.macroAdjustment),     // macro adj (−20 to +20)
            quantBonus: asFinite(signal.correlationBonus),    // correlation bonus (0–10)
            totalScore: asFinite(signal.totalScore),

            // Entry / risk
            entryZoneHigh: asFiniteNullable(signal.entryZone.high),
            entryZoneLow: asFiniteNullable(signal.entryZone.low),
            entryZoneMid: asFiniteNullable(signal.entryZone.mid),
            stopLoss: asFiniteNullable(signal.stopLoss),
            tp1: asFiniteNullable(signal.tp1),
            tp2: asFiniteNullable(signal.tp2),
            tp3: asFiniteNullable(signal.tp3),
            riskRewardRatio: asFiniteNullable(signal.riskRewardRatio),
            positionSize: asFiniteNullable(signal.positionSize),
            riskAmount: asFiniteNullable(signal.riskAmount),
            historicalWinRate: null,
            expectedValue: null,

            // Meta
            newsRisk: signal.newsRisk,
            reasoning: signal.setupDescription,
            macroSummary: signal.macroContext,

            // JSON blobs
            smcSetupJson: toJsonSafe({
              setupType: signal.setupType,
              orderFlowConfirmation: signal.orderFlowConfirmation,
            } as object),
            taConfluenceJson: toJsonSafe({
              patterns: signal.patterns,
              confirmationCandles: signal.confirmationCandles,
            } as object),
            macroScoreJson: toJsonSafe(signal.regime as object),
            quantAnalysisJson: toJsonSafe({
              kellyFraction: asFiniteNullable(signal.kellyFraction),
            } as object),
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

export interface PersistedSignalForReasoning {
  id: string;
  cycleId: string;
  assetId: string;
  direction: 'long' | 'short';
  setupType: string;
  totalScore: number;
  entryZone: {
    high: number;
    low: number;
    mid: number;
  };
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskRewardRatio: number;
  positionSize: number;
  riskAmount: number;
  candleQuality: number;
  orderFlowConfidence: number;
  smcTaAlignment: number;
  macroAdjustment: number;
  correlationBonus: number;
}

function parseSetupType(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return 'unknown';
  const setupType = (raw as { setupType?: unknown }).setupType;
  return typeof setupType === 'string' && setupType.length > 0 ? setupType : 'unknown';
}

function parseOrderFlowConfidence(raw: unknown): number {
  if (!raw || typeof raw !== 'object') return 0;
  const orderFlow = (raw as { orderFlowConfirmation?: unknown }).orderFlowConfirmation;
  if (!orderFlow || typeof orderFlow !== 'object') return 0;
  const confidence = (orderFlow as { confidence?: unknown }).confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(25, Math.round(confidence / 4)));
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export async function getPersistedSignalsForCycle(cycleId: string): Promise<PersistedSignalForReasoning[]> {
  const rows = await prisma.indicesSignal.findMany({
    where: { cycleId },
    orderBy: { rank: 'asc' },
    select: {
      id: true,
      cycleId: true,
      assetId: true,
      direction: true,
      totalScore: true,
      entryZoneHigh: true,
      entryZoneLow: true,
      entryZoneMid: true,
      stopLoss: true,
      tp1: true,
      tp2: true,
      tp3: true,
      riskRewardRatio: true,
      positionSize: true,
      riskAmount: true,
      taScore: true,
      smcScore: true,
      macroScore: true,
      quantBonus: true,
      smcSetupJson: true,
    },
  });

  return rows.map((row: {
    id: string;
    cycleId: string;
    assetId: string;
    direction: 'long' | 'short';
    totalScore: number;
    entryZoneHigh: number | null;
    entryZoneLow: number | null;
    entryZoneMid: number | null;
    stopLoss: number | null;
    tp1: number | null;
    tp2: number | null;
    tp3: number | null;
    riskRewardRatio: number | null;
    positionSize: number | null;
    riskAmount: number | null;
    taScore: number;
    smcScore: number;
    macroScore: number;
    quantBonus: number;
    smcSetupJson: unknown;
  }) => ({
    id: row.id,
    cycleId: row.cycleId,
    assetId: row.assetId,
    direction: row.direction,
    setupType: parseSetupType(row.smcSetupJson),
    totalScore: toNumber(row.totalScore),
    entryZone: {
      high: toNumber(row.entryZoneHigh),
      low: toNumber(row.entryZoneLow),
      mid: toNumber(row.entryZoneMid),
    },
    stopLoss: toNumber(row.stopLoss),
    tp1: toNumber(row.tp1),
    tp2: toNumber(row.tp2),
    tp3: toNumber(row.tp3),
    riskRewardRatio: toNumber(row.riskRewardRatio),
    positionSize: toNumber(row.positionSize),
    riskAmount: toNumber(row.riskAmount),
    candleQuality: toNumber(row.taScore),
    orderFlowConfidence: parseOrderFlowConfidence(row.smcSetupJson),
    smcTaAlignment: toNumber(row.smcScore),
    macroAdjustment: toNumber(row.macroScore),
    correlationBonus: toNumber(row.quantBonus),
  }));
}

export async function updateCycleSignalRanks(
  cycleId: string,
  rankedSignalIds: string[],
): Promise<void> {
  if (rankedSignalIds.length === 0) return;

  await prisma.$transaction(
    rankedSignalIds.map((signalId, index) =>
      prisma.indicesSignal.updateMany({
        where: { id: signalId, cycleId },
        data: { rank: index + 1 },
      }),
    ),
  );
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
