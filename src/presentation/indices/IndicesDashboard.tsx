'use client';
// src/presentation/indices/IndicesDashboard.tsx
// Main indices + forex trading dashboard (client component with auto-refresh)

import { useState, useEffect, useCallback } from 'react';
import type { RankedSignal, MacroContext, CorrelationPair } from '@/src/indices/types';
import { SignalCard } from './components/SignalCard';
import { MacroPanel } from './components/MacroPanel';
import { CorrelationMatrix } from './components/CorrelationMatrix';

type DashboardState = {
  signals: RankedSignal[];
  executable: RankedSignal[];
  watchlist: RankedSignal[];
  macro: MacroContext | null;
  correlations: CorrelationPair[];
  lastCycleAt: number | null;
  cycleRunning: boolean;
  loading: boolean;
  error: string | null;
};

const REFRESH_INTERVAL_MS = 4 * 60 * 1000; // 4 hours (match cycle frequency)

export function IndicesDashboard() {
  const [state, setState] = useState<DashboardState>({
    signals: [],
    executable: [],
    watchlist: [],
    macro: null,
    correlations: [],
    lastCycleAt: null,
    cycleRunning: false,
    loading: true,
    error: null,
  });

  const fetchAll = useCallback(async () => {
    try {
      const [signalsRes, macroRes, corrRes] = await Promise.all([
        fetch('/api/indices/current'),
        fetch('/api/indices/macro'),
        fetch('/api/indices/correlation'),
      ]);

      const [signalsData, macroData, corrData] = await Promise.all([
        signalsRes.json(),
        macroRes.json(),
        corrRes.json(),
      ]);

      setState(prev => ({
        ...prev,
        signals: signalsData.signals ?? [],
        executable: signalsData.executable ?? [],
        watchlist: signalsData.watchlist ?? [],
        macro: macroData.macro ?? prev.macro,
        correlations: corrData.pairs ?? [],
        lastCycleAt: signalsData.status?.lastCycleAt ?? prev.lastCycleAt,
        cycleRunning: signalsData.status?.cycleRunning ?? false,
        loading: false,
        error: null,
      }));
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load data',
      }));
    }
  }, []);

  const triggerCycle = async () => {
    setState(prev => ({ ...prev, cycleRunning: true }));
    try {
      await fetch('/api/indices/cycle', { method: 'POST' });
      setTimeout(fetchAll, 3000); // allow cycle to complete
    } catch {
      setState(prev => ({ ...prev, cycleRunning: false }));
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const lastCycleLabel = state.lastCycleAt
    ? new Date(state.lastCycleAt).toLocaleTimeString()
    : 'Never';

  return (
    <div className="min-h-screen bg-[#080808] text-white p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">Indices + Forex</h1>
          <p className="text-xs text-zinc-500">SMC · TA · Macro · Quant</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-500">Last scan: {lastCycleLabel}</span>
          <button
            onClick={triggerCycle}
            disabled={state.cycleRunning}
            className="px-3 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 transition-colors border border-zinc-700"
          >
            {state.cycleRunning ? 'Scanning…' : 'Scan Now'}
          </button>
        </div>
      </div>

      {/* Loading / Error */}
      {state.loading && (
        <div className="text-center text-zinc-500 text-sm py-12">Loading market data…</div>
      )}
      {state.error && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 text-red-300 text-sm">
          {state.error}
        </div>
      )}

      {/* Executable signals */}
      {!state.loading && (
        <>
          {state.executable.length > 0 ? (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
                Executable Setups ({state.executable.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {state.executable.map(s => (
                  <SignalCard key={`${s.assetId}-${s.rank}`} signal={s} />
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-[#0d0d0d] border border-zinc-800 rounded-xl p-6 text-center text-zinc-500 text-sm">
              No executable setups this cycle — {state.watchlist.length > 0 ? `${state.watchlist.length} on watchlist` : 'all assets below threshold'}
            </div>
          )}

          {/* Watchlist */}
          {state.watchlist.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
                Watchlist ({state.watchlist.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {state.watchlist.map(s => (
                  <SignalCard key={`${s.assetId}-${s.rank}`} signal={s} />
                ))}
              </div>
            </div>
          )}

          {/* Macro */}
          {state.macro && (
            <div className="bg-[#0d0d0d] border border-zinc-800 rounded-xl p-4">
              <MacroPanel macro={state.macro} />
            </div>
          )}

          {/* Correlation */}
          {state.correlations.length > 0 && (
            <div className="bg-[#0d0d0d] border border-zinc-800 rounded-xl p-4 overflow-x-auto">
              <CorrelationMatrix pairs={state.correlations} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
