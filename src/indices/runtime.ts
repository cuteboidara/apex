// src/indices/runtime.ts
// AMT cycle orchestrator — singleton runtime state (Next.js hot-reload safe)

import type { AssetInput, AMTRankingInput } from './engine/ranking/amtRanker';
import type { AMTSignal } from './types/amtTypes';
import { rankAMTSignals, buildCycleResult } from './engine/ranking/amtRanker';
import {
  getPersistedSignalsForCycle,
  persistAMTSignals,
  persistAssetStates,
  updateCycleSignalRanks,
} from './api/amtSignals';
import { formatAMTAlert } from './alerts/formatter';
import { fetchMacroContext } from './data/fetchers/macroFetcher';
import { ReasoningOrchestrator } from './reasoning/ReasoningOrchestrator';
import type { ReasoningMarketData } from './reasoning/types';

// ─── Asset imports ─────────────────────────────────────────────────────────
// These use the existing SMC engine data fetchers to supply candles + OBs + FVGs.
// Import paths match the Phase 1 build.

import { fetchIndexCandles } from './data/fetchers/indicesFetcher';
import { fetchForexCandles } from './data/fetchers/forexFetcher';
import { fetchCommodityCandles } from './data/fetchers/commodityFetcher';
import { fetchRateCandles } from './data/fetchers/ratesFetcher';
import { runSMCAnalysis } from './engine/smc/smcScorer';
import { ASSET_SYMBOLS, isForex, isIndex, isCommodity, isRate, type AssetSymbol } from './data/fetchers/assetConfig';
import { computeCorrelationMatrix } from './engine/quant/correlationMatrix';
import type { Candle } from './types';

const reasoningOrchestrator = new ReasoningOrchestrator();

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

const INDEX_ASSETS: AssetSymbol[] = ASSET_SYMBOLS.filter(isIndex);
const FOREX_ASSETS: AssetSymbol[] = ASSET_SYMBOLS.filter(isForex);
const COMMODITY_ASSETS: AssetSymbol[] = ASSET_SYMBOLS.filter(isCommodity);
const RATE_ASSETS: AssetSymbol[] = ASSET_SYMBOLS.filter(isRate);
const ALL_ASSETS: AssetSymbol[] = [...INDEX_ASSETS, ...FOREX_ASSETS, ...COMMODITY_ASSETS, ...RATE_ASSETS];
const ASSET_FETCH_TIMEOUT_MS = 20_000;

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// ─── Data Fetching ─────────────────────────────────────────────────────────

interface AssetFetchResult {
  input: AssetInput;
  dailyCandles: Candle[];
  recentCandles: Candle[];
  currentPrice: number;
}

export interface RunAMTCycleOptions {
  skipReasoning?: boolean;
  skipTelegram?: boolean;
}

function isReasoningEnabled(): boolean {
  const raw = process.env.LLM_REASONING_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

async function fetchAssetInput(assetId: AssetSymbol): Promise<AssetFetchResult | null> {
  try {
    // Fetch candles using the appropriate fetcher per asset class
    let mtfData;
    if (INDEX_ASSETS.includes(assetId)) {
      mtfData = await fetchIndexCandles(assetId);
    } else if (COMMODITY_ASSETS.includes(assetId)) {
      mtfData = await fetchCommodityCandles(assetId);
    } else if (RATE_ASSETS.includes(assetId)) {
      mtfData = await fetchRateCandles(assetId);
    } else {
      mtfData = await fetchForexCandles(assetId);
    }

    // Prefer 4H for AMT pattern detection; fall back to daily
    const candles = mtfData.h4.length >= 10 ? mtfData.h4 : mtfData.daily;
    if (candles.length < 10) {
      console.warn(`[amt-runtime] Insufficient candles for ${assetId}: ${candles.length}`);
      return null;
    }

    const currentPrice = mtfData.currentPrice ?? candles[candles.length - 1]?.close ?? 0;
    if (currentPrice === 0) return null;

    // Run SMC analysis to get order blocks and FVGs
    const smcResult = runSMCAnalysis(assetId, mtfData.daily.length > 0 ? mtfData.daily : candles);

    return {
      input: {
        assetId,
        candles,
        orderBlocks: smcResult ? [smcResult.orderBlock] : [],
        fvgs: smcResult?.fvg ? [smcResult.fvg] : [],
        currentPrice,
      },
      dailyCandles: mtfData.daily,
      recentCandles: candles,
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
}>;
export async function runAMTCycle(options: RunAMTCycleOptions): Promise<{
  success: boolean;
  cycleId: string | null;
  executableCount: number;
  watchlistCount: number;
  signals: AMTSignal[];
  error?: string;
}>;
export async function runAMTCycle(options?: RunAMTCycleOptions): Promise<{
  success: boolean;
  cycleId: string | null;
  executableCount: number;
  watchlistCount: number;
  signals: AMTSignal[];
  error?: string;
}> {
  const skipReasoning = options?.skipReasoning ?? false;
  const skipTelegram = options?.skipTelegram ?? false;
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
    const fetchResults = await Promise.all(
      ALL_ASSETS.map(async (id: AssetSymbol) => {
        const result = await withTimeout(fetchAssetInput(id), ASSET_FETCH_TIMEOUT_MS);
        if (!result) {
          console.warn(`[amt-runtime] Timeout or fetch failure for ${id}`);
        }
        return result;
      }),
    );

    const validFetches = fetchResults.filter((r): r is AssetFetchResult => r !== null);
    const validAssets = validFetches.map(r => r.input);
    console.log(`[amt-runtime] Fetched ${validAssets.length}/${ALL_ASSETS.length} assets`);

    if (validAssets.length === 0) {
      throw new Error('No asset data available');
    }

    // 2b. Compute correlation matrix from daily candles of all fetched assets
    const dailyCandleMap = new Map<AssetSymbol, Candle[]>(
      validFetches
        .filter(r => r.dailyCandles.length > 5)
        .map(r => [r.input.assetId as AssetSymbol, r.dailyCandles]),
    );
    if (dailyCandleMap.size > 1) {
      computeCorrelationMatrix(dailyCandleMap).catch(err =>
        console.warn('[amt-runtime] Correlation compute failed:', err),
      );
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

    // 5. Persist signals + asset scan states
    const hasDatabaseUrl = Boolean(process.env.DATABASE_URL || process.env.DIRECT_DATABASE_URL);
    if (hasDatabaseUrl) {
      const signalAssetIds = new Set(ranking.ranked.map(s => s.assetId));
      const assetStateData = validFetches.map(r => ({
        assetId: r.input.assetId,
        lastPrice: r.currentPrice,
        hasSignal: signalAssetIds.has(r.input.assetId),
      }));

      await Promise.all([
        persistAMTSignals(cycleResult),
        persistAssetStates(cycleResult.cycleId, assetStateData).catch(err =>
          console.warn('[amt-runtime] Asset state persist failed (table may need migration):', err),
        ),
      ]);

      if (isReasoningEnabled() && !skipReasoning) {
        try {
          const persistedSignals = await getPersistedSignalsForCycle(cycleResult.cycleId);
          const eligibleSignals = persistedSignals.filter(signal => signal.totalScore >= 40);

          if (eligibleSignals.length > 0) {
            console.log(`[amt-runtime] Running LLM reasoning for ${eligibleSignals.length} signals`);

            const marketDataMap = new Map<string, ReasoningMarketData>(
              validFetches.map(fetch => [
                fetch.input.assetId,
                {
                  recentCandles: fetch.recentCandles,
                  currentPrice: fetch.currentPrice,
                },
              ]),
            );

            const reasonedSignals = await reasoningOrchestrator.batchAnalyze(
              eligibleSignals,
              marketDataMap,
              macro,
            );

            const finalScoreMap = new Map(reasonedSignals.map(result => [
              result.signalId,
              result.decision.finalScore,
            ]));

            const reranked = [...persistedSignals].sort(
              (left, right) =>
                (finalScoreMap.get(right.id) ?? right.totalScore)
                - (finalScoreMap.get(left.id) ?? left.totalScore),
            );

            await updateCycleSignalRanks(
              cycleResult.cycleId,
              reranked.map(signal => signal.id),
            );

            console.log(`[amt-runtime] LLM reasoning complete for ${reasonedSignals.length} signals`);
          } else {
            console.log('[amt-runtime] LLM reasoning skipped (no eligible signals >= 40)');
          }
        } catch (reasoningError) {
          console.warn('[amt-runtime] LLM reasoning layer failed:', reasoningError);
        }
      } else if (skipReasoning) {
        console.log('[amt-runtime] LLM reasoning skipped (manual quick mode)');
      }
    } else {
      console.warn('[amt-runtime] DATABASE_URL / DIRECT_DATABASE_URL not set — skipping DB persistence');
    }

    // 6. Format + send Telegram
    if (!skipTelegram) {
      const alert = formatAMTAlert(cycleResult);
      for (const msg of alert.telegramMessages) {
        try {
          await sendTelegramMessage(msg);
        } catch (tgErr) {
          console.warn('[amt-runtime] Telegram send failed:', tgErr);
        }
      }
    } else {
      console.log('[amt-runtime] Telegram send skipped (manual quick mode)');
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
