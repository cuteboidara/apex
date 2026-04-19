// src/indices/runtime.ts
// AMT cycle orchestrator — singleton runtime state (Next.js hot-reload safe)

import type { AssetInput, AMTRankingInput } from './engine/ranking/amtRanker';
import type { AMTSignal } from './types/amtTypes';
import { rankAMTSignals, buildCycleResult } from './engine/ranking/amtRanker';
import { persistAMTSignals } from './api/amtSignals';
import { formatAMTAlert } from './alerts/formatter';
import { fetchMacroContext } from './data/fetchers/macroFetcher';

// ─── Asset imports ─────────────────────────────────────────────────────────
// These use the existing SMC engine data fetchers to supply candles + OBs + FVGs.
// Import paths match the Phase 1 build.

import { fetchIndexCandles } from './data/fetchers/indicesFetcher';
import { fetchForexCandles } from './data/fetchers/forexFetcher';
import { runSMCAnalysis } from './engine/smc/smcScorer';
import { ASSET_SYMBOLS, isForex, isIndex, type AssetSymbol } from './data/fetchers/assetConfig';

// ─── Telegram send ─────────────────────────────────────────────────────────
// Reuse the existing Telegram client directly.
async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

// ─── Asset Universe ────────────────────────────────────────────────────────

const INDEX_ASSETS: AssetSymbol[] = ASSET_SYMBOLS.filter(symbol => isIndex(symbol));
const FOREX_ASSETS: AssetSymbol[] = ASSET_SYMBOLS.filter(symbol => isForex(symbol));
const ALL_ASSETS: AssetSymbol[] = [...INDEX_ASSETS, ...FOREX_ASSETS];

// ─── Singleton State ───────────────────────────────────────────────────────

interface AMTRuntimeState {
  cycleRunning: boolean;
  lastCycleAt: number | null;
  lastCycleId: string | null;
  executableCount: number;
  watchlistCount: number;
}

const GLOBAL_KEY = '__apexAMTRuntime__';

function getState(): AMTRuntimeState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      cycleRunning: false,
      lastCycleAt: null,
      lastCycleId: null,
      executableCount: 0,
      watchlistCount: 0,
    } satisfies AMTRuntimeState;
  }
  return g[GLOBAL_KEY] as AMTRuntimeState;
}

function updateState(patch: Partial<AMTRuntimeState>): void {
  const state = getState();
  Object.assign(state, patch);
}

// ─── Data Fetching ─────────────────────────────────────────────────────────

async function fetchAssetInput(assetId: AssetSymbol): Promise<AssetInput | null> {
  try {
    const indexAsset = INDEX_ASSETS.includes(assetId);

    // Fetch candles (use 4H candles for AMT — sufficient for FVA + pattern detection)
    const mtfData = indexAsset
      ? await fetchIndexCandles(assetId)
      : await fetchForexCandles(assetId);

    const candles = mtfData.h4 ?? mtfData.daily ?? [];
    if (candles.length < 10) {
      console.warn(`[amt-runtime] Insufficient candles for ${assetId}: ${candles.length}`);
      return null;
    }

    const currentPrice = candles[candles.length - 1]?.close ?? 0;
    if (currentPrice === 0) return null;

    // Run SMC analysis to get order blocks and FVGs
    const smcResult = runSMCAnalysis(
      assetId,
      mtfData.daily ?? candles,
    );

    return {
      assetId,
      candles,
      orderBlocks: smcResult ? [smcResult.orderBlock] : [],
      fvgs: smcResult?.fvg ? [smcResult.fvg] : [],
      currentPrice,
    };
  } catch (err) {
    console.error(`[amt-runtime] Failed to fetch ${assetId}:`, err);
    return null;
  }
}

// ─── Main Cycle ────────────────────────────────────────────────────────────

/**
 * Run a full AMT signal cycle:
 * 1. Fetch macro context
 * 2. Fetch candles + SMC data for all assets in parallel
 * 3. Rank AMT signals
 * 4. Persist to DB
 * 5. Send Telegram alert
 *
 * @returns  AMTCycleResult summary (for API response)
 */
export async function runAMTCycle(): Promise<{
  success: boolean;
  cycleId: string | null;
  executableCount: number;
  watchlistCount: number;
  signals: AMTSignal[];
  error?: string;
}> {
  const state = getState();

  if (state.cycleRunning) {
    return {
      success: false,
      cycleId: null,
      executableCount: 0,
      watchlistCount: 0,
      signals: [],
      error: 'Cycle already running',
    };
  }

  updateState({ cycleRunning: true });

  try {
    console.log('[amt-runtime] Starting AMT cycle...');

    // 1. Macro context
    const macro = await fetchMacroContext();

    // 2. Fetch all assets in parallel
    const assetInputs = await Promise.all(
      ALL_ASSETS.map((id: AssetSymbol) => fetchAssetInput(id)),
    );

    const validAssets = assetInputs.filter((a): a is AssetInput => a !== null);
    console.log(`[amt-runtime] Fetched ${validAssets.length}/${ALL_ASSETS.length} assets`);

    if (validAssets.length === 0) {
      throw new Error('No asset data available');
    }

    // 3. Rank signals
    const rankingInput: AMTRankingInput = { assets: validAssets, macro };
    const ranking = rankAMTSignals(rankingInput);

    console.log(
      `[amt-runtime] Ranked: ${ranking.ranked.length} total, ` +
      `${ranking.executable.length} executable, ${ranking.watchlist.length} watchlist`,
    );

    // 4. Build cycle result
    const cycleResult = buildCycleResult(ranking, macro);

    // 5. Persist (skip if no DB configured)
    if (process.env.DATABASE_URL) {
      await persistAMTSignals(cycleResult);
    } else {
      console.warn('[amt-runtime] DATABASE_URL not set — skipping DB persistence');
    }

    // 6. Format + send Telegram
    const alert = formatAMTAlert(cycleResult);
    for (const msg of alert.telegramMessages) {
      try {
        await sendTelegramMessage(msg);
      } catch (tgErr) {
        console.warn('[amt-runtime] Telegram send failed:', tgErr);
      }
    }

    // 7. Update state
    updateState({
      cycleRunning: false,
      lastCycleAt: Date.now(),
      lastCycleId: cycleResult.cycleId,
      executableCount: ranking.executable.length,
      watchlistCount: ranking.watchlist.length,
    });

    console.log(`[amt-runtime] Cycle complete: ${cycleResult.cycleId}`);

    return {
      success: true,
      cycleId: cycleResult.cycleId,
      executableCount: ranking.executable.length,
      watchlistCount: ranking.watchlist.length,
      signals: ranking.ranked,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[amt-runtime] Cycle failed:', message);

    updateState({ cycleRunning: false });

    return {
      success: false,
      cycleId: null,
      executableCount: 0,
      watchlistCount: 0,
      signals: [],
      error: message,
    };
  }
}

/**
 * Get current runtime status (for dashboard polling).
 */
export function getAMTRuntimeStatus(): AMTRuntimeState {
  return { ...getState() };
}
