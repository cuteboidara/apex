// src/indices/indicesRuntime.ts
// Main orchestrator: data → SMC → TA → Macro → Quant → Rank → Alert

import { createId } from '@/src/lib/ids';
import type { RankedSignal, MacroContext } from '@/src/indices/types';
import type { AssetSymbol } from '@/src/indices/data/fetchers/assetConfig';
import { ASSET_SYMBOLS, isForex } from '@/src/indices/data/fetchers/assetConfig';
import { fetchIndexCandles } from './data/fetchers/indicesFetcher';
import { fetchForexCandles } from './data/fetchers/forexFetcher';
import { fetchMacroContext } from './data/fetchers/macroFetcher';
import { rankSignals } from './engine/ranking/signalRanker';
import { formatSignalAlert } from './engine/alertFormatter';
import type { MultiTimeframeCandles } from './data/fetchers/indicesFetcher';
import { getCache, setCache, CacheKeys, CacheTTL } from './data/cache/cacheManager';

// ─── Runtime State ────────────────────────────────────────────────────────────

type IndicesRuntimeState = {
  latestSignals: RankedSignal[];
  lastCycleAt: number | null;
  cycleRunning: boolean;
  lastMacroContext: MacroContext | null;
};

const globalForIndicesRuntime = globalThis as typeof globalThis & {
  __apexIndicesRuntime?: IndicesRuntimeState;
};

const state = globalForIndicesRuntime.__apexIndicesRuntime ??= {
  latestSignals: [],
  lastCycleAt: null,
  cycleRunning: false,
  lastMacroContext: null,
};

// ─── Main Cycle ───────────────────────────────────────────────────────────────

export async function triggerIndicesCycle(options?: {
  accountSize?: number;
  riskPct?: number;
  minScore?: number;
  enabledAssets?: AssetSymbol[];
}): Promise<{ cycleId: string; signalCount: number; signals: RankedSignal[] }> {
  if (state.cycleRunning) {
    console.log('[indices-runtime] Cycle already running, skipping');
    return { cycleId: 'skipped', signalCount: state.latestSignals.length, signals: state.latestSignals };
  }

  const cycleId = createId('indicescycle');
  state.cycleRunning = true;

  try {
    console.log(`[indices-runtime] Starting cycle ${cycleId}`);
    const assets = options?.enabledAssets ?? [...ASSET_SYMBOLS];

    // ── 1. Fetch all candle data in parallel ──────────────────────────────
    const candleEntries = await Promise.all(
      assets.map(async (symbol) => {
        try {
          const data = isForex(symbol)
            ? await fetchForexCandles(symbol)
            : await fetchIndexCandles(symbol);
          return [symbol, data] as [AssetSymbol, MultiTimeframeCandles];
        } catch (error) {
          console.error(`[indices-runtime] Candle fetch failed for ${symbol}:`, error);
          return null;
        }
      }),
    );

    const candlesByAsset = new Map<AssetSymbol, MultiTimeframeCandles>(
      candleEntries.filter((e): e is [AssetSymbol, MultiTimeframeCandles] => e != null),
    );

    // ── 2. Fetch macro context ────────────────────────────────────────────
    const macroContext = await fetchMacroContext().catch(err => {
      console.error('[indices-runtime] Macro fetch failed:', err);
      return state.lastMacroContext;
    });

    if (!macroContext) {
      throw new Error('No macro context available');
    }
    state.lastMacroContext = macroContext;

    // ── 3. Run full ranking pipeline ──────────────────────────────────────
    const signals = await rankSignals(candlesByAsset, macroContext, {
      accountSize: options?.accountSize,
      riskPct: options?.riskPct,
      minScore: options?.minScore,
    });

    // ── 4. Update state ───────────────────────────────────────────────────
    state.latestSignals = signals;
    state.lastCycleAt = Date.now();
    await setCache(CacheKeys.signals(), signals, CacheTTL.signals);

    // ── 5. Format + log alerts ────────────────────────────────────────────
    const alert = formatSignalAlert(signals);
    console.log(`[indices-runtime] Cycle ${cycleId} complete — ${signals.length} signals`);
    if (signals.length > 0) {
      console.log('[indices-runtime] Alert preview:', alert.summary);
    }

    // ── 6. Send Telegram (optional) ───────────────────────────────────────
    if (signals.length > 0 && process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
      await sendTelegramAlert(alert.telegramText).catch(err => {
        console.error('[indices-runtime] Telegram send failed:', err);
      });
    }

    return { cycleId, signalCount: signals.length, signals };
  } finally {
    state.cycleRunning = false;
  }
}

// ─── State Accessors ──────────────────────────────────────────────────────────

export function getLatestIndicesSignals(): RankedSignal[] {
  return [...state.latestSignals];
}

export function getIndicesRuntimeStatus() {
  return {
    lastCycleAt: state.lastCycleAt,
    cycleRunning: state.cycleRunning,
    signalCount: state.latestSignals.length,
    executableCount: state.latestSignals.filter(s => s.scores.total >= 60).length,
  };
}

export function resetIndicesRuntimeForTests(): void {
  state.latestSignals = [];
  state.lastCycleAt = null;
  state.cycleRunning = false;
  state.lastMacroContext = null;
}

// ─── Telegram ─────────────────────────────────────────────────────────────────

async function sendTelegramAlert(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  const axios = (await import('axios')).default;

  // Split long messages (Telegram limit: 4096 chars)
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 4000) {
    const splitAt = remaining.lastIndexOf('\n', 4000);
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt + 1);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    await axios.post(url, {
      chat_id: chatId,
      text: chunk,
      parse_mode: 'Markdown',
    }, { timeout: 10_000 });
  }
}
