// src/indices/engine/ranking/amtRanker.ts
// Rank top-3 AMT signals across all assets

import type { Candle, MacroContext, OrderBlock, FairValueGap } from '@/src/indices/types';
import type { AMTSignal, AMTCycleResult } from '@/src/indices/types/amtTypes';
import { detectAMTSetups } from '../amt/setupDetector';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface AssetInput {
  assetId: string;
  candles: Candle[];
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
  currentPrice: number;
}

export interface AMTRankingInput {
  assets: AssetInput[];
  macro: MacroContext;
}

// ─── Score Thresholds ──────────────────────────────────────────────────────

const EXECUTABLE_MIN_SCORE = 60;  // signals ≥60 are ready to trade
const WATCHLIST_MIN_SCORE = 40;   // signals 40–59 are on watchlist
const RANK_TOP_N = 3;             // top 3 across all assets

// ─── Deduplication ────────────────────────────────────────────────────────

/**
 * If we have two opposite-direction signals for the same asset, keep only the higher score.
 */
function deduplicateByAsset(signals: AMTSignal[]): AMTSignal[] {
  const seen = new Map<string, AMTSignal>();

  for (const s of signals) {
    const existing = seen.get(s.assetId);
    if (!existing || s.totalScore > existing.totalScore) {
      seen.set(s.assetId, s);
    }
  }

  return Array.from(seen.values());
}

/**
 * Don't rank signals that are blocked by calendar risk.
 */
function filterBlocked(signals: AMTSignal[]): AMTSignal[] {
  return signals.filter(s => s.newsRisk !== 'blocked');
}

// ─── Ranker ───────────────────────────────────────────────────────────────

/**
 * Run AMT setup detection across all assets, rank top 3 overall.
 *
 * Process:
 * 1. Detect setups for each asset
 * 2. Collect all candidates
 * 3. Deduplicate per asset (best direction wins)
 * 4. Filter blocked signals
 * 5. Sort by totalScore descending
 * 6. Assign ranks 1, 2, 3
 * 7. Split into executable (≥60) and watchlist (40–59)
 */
export function rankAMTSignals(input: AMTRankingInput): {
  ranked: AMTSignal[];
  executable: AMTSignal[];
  watchlist: AMTSignal[];
} {
  const { assets, macro } = input;

  // Gather all candidates
  const allCandidates: AMTSignal[] = [];

  for (const asset of assets) {
    const setups = detectAMTSetups({
      assetId: asset.assetId,
      candles: asset.candles,
      orderBlocks: asset.orderBlocks,
      fvgs: asset.fvgs,
      macro,
      currentPrice: asset.currentPrice,
    });

    allCandidates.push(...setups);
  }

  // Deduplicate and filter
  const deduped = deduplicateByAsset(allCandidates);
  const filtered = filterBlocked(deduped);

  // Sort by score
  const sorted = filtered.sort((a, b) => b.totalScore - a.totalScore);

  // Take top N and assign ranks
  const ranked = sorted.slice(0, RANK_TOP_N).map((s, i) => ({
    ...s,
    rank: i + 1,
  }));

  const executable = ranked.filter(s => s.totalScore >= EXECUTABLE_MIN_SCORE);
  const watchlist = ranked.filter(
    s => s.totalScore >= WATCHLIST_MIN_SCORE && s.totalScore < EXECUTABLE_MIN_SCORE,
  );

  return { ranked, executable, watchlist };
}

/**
 * Build a full AMTCycleResult from ranking output.
 */
export function buildCycleResult(
  ranking: { ranked: AMTSignal[]; executable: AMTSignal[]; watchlist: AMTSignal[] },
  macro: MacroContext,
): AMTCycleResult {
  const cycleId = `amt-${Date.now()}`;

  // Derive regime from best signal (or use a neutral placeholder)
  const regime = ranking.ranked[0]?.regime ?? buildNeutralRegime(macro);

  const nextCycleAt = new Date(Date.now() + 4 * 60 * 60 * 1000); // +4h

  return {
    cycleId,
    generatedAt: new Date(),
    signals: ranking.ranked,
    executable: ranking.executable,
    watchlist: ranking.watchlist,
    regime,
    nextCycleAt,
  };
}

/** Fallback regime when no signals are generated. */
function buildNeutralRegime(macro: MacroContext): AMTCycleResult['regime'] {
  return {
    dxy: {
      trend: macro.dxy.trend === 'up' ? 'up' : macro.dxy.trend === 'down' ? 'down' : 'neutral',
      value: macro.dxy.price,
      change24h: macro.dxy.change24h,
      alignment: 0,
    },
    vix: {
      regime: macro.vix.regime,
      value: macro.vix.price,
      volatilityAdjustment: 1.0,
      confidenceAdjustment: 0,
    },
    yields: {
      trend: macro.yield10y.trend === 'up' ? 'rising' : macro.yield10y.trend === 'down' ? 'falling' : 'stable',
      value: macro.yield10y.price,
      change5d: macro.yield10y.change5d,
      equityBias: 0,
    },
    calendar: {
      eventRisk: 'clear',
      nextEvent: macro.economicEvents[0] ?? null,
      timeToEventMinutes: 999,
      riskAdjustment: 0,
    },
    sentiment: {
      fearGreed: macro.sentiment.fearGreed,
      bias: macro.sentiment.classification,
      contraryBias: 0,
    },
    combinedAdjustment: 0,
  };
}
