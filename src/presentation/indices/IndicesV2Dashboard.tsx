'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { AMTMacroPanel } from './components/AMTMacroPanel';
import { CorrelationMatrix } from './components/CorrelationMatrix';
import { SignalDetail } from './components/SignalDetail';
import { SignalsPanel } from './components/SignalsPanel';
import type { PaperStats } from './components/StatsGrid';
import {
  AMT_CLASS_ASSETS,
  getClassRoute,
  isAMTClassSection,
  type AMTClassSection,
  type AMTSection,
} from './sections';
import type { AssetState, CorrelationPair, DBSignal, MacroContextData } from './types';

type RuntimeStatus = {
  cycleRunning: boolean;
  lastCycleAt: number | null;
  lastCycleId: string | null;
  executableCount: number;
  watchlistCount: number;
};

const EMPTY_RUNTIME_STATUS: RuntimeStatus = {
  cycleRunning: false,
  lastCycleAt: null,
  lastCycleId: null,
  executableCount: 0,
  watchlistCount: 0,
};

const REFRESH_INTERVAL_MS = 45_000;

function statusTone(score: number): string {
  if (score >= 60) return 'text-[var(--accent-green)]';
  if (score >= 40) return 'text-[var(--accent-yellow)]';
  return 'text-[var(--text-secondary)]';
}

function formatTime(ts: number | null): string {
  if (!ts) return 'Never';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getClassRegimeTitle(section: AMTClassSection, macro: MacroContextData | null): string {
  if (!macro) return 'Regime unavailable';

  if (section === 'fx') {
    return macro.dxy.trend === 'down' ? 'USD weakness regime' : macro.dxy.trend === 'up' ? 'USD strength regime' : 'Mixed USD regime';
  }

  if (section === 'indices') {
    return macro.vix.regime === 'low' ? 'Risk-on index regime' : macro.vix.regime === 'high' ? 'Risk-off index regime' : 'Balanced index regime';
  }

  if (section === 'commodities') {
    return macro.sentiment.fearGreed >= 55 ? 'Pro-cyclical commodity bid' : 'Defensive commodity rotation';
  }

  return macro.yield10y.trend === 'up' ? 'Rates trend up' : macro.yield10y.trend === 'down' ? 'Rates trend down' : 'Rates neutral';
}

function matchesClassSection(section: AMTClassSection, signal: DBSignal): boolean {
  const symbols = AMT_CLASS_ASSETS[section].map(asset => asset.symbol);
  return symbols.includes(signal.assetId);
}

function AssetClassGrid({
  section,
  signals,
  assetStates,
}: {
  section: AMTClassSection;
  signals: DBSignal[];
  assetStates: AssetState[];
}) {
  const entries = AMT_CLASS_ASSETS[section].map(asset => {
    const latest = signals.find(signal => signal.assetId === asset.symbol);
    const state = assetStates.find(s => s.assetId === asset.symbol);
    return { asset, latest, state };
  });

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map(({ asset, latest, state }) => (
        <Link
          key={asset.symbol}
          href={getClassRoute(section, asset.symbol)}
          className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 transition-colors hover:border-[var(--accent-blue)]/40"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-base font-semibold text-[var(--text-primary)]">{asset.symbol}</p>
              <p className="text-xs text-[var(--text-secondary)]">{asset.label}</p>
            </div>
            <span
              className={[
                'rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
                latest && latest.totalScore >= 60
                  ? 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
                  : state
                    ? 'border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
                    : 'border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-muted)]',
              ].join(' ')}
            >
              {latest ? `${latest.totalScore}` : state ? 'Scanned' : 'Pending'}
            </span>
          </div>

          {latest ? (
            <div className="mt-4 space-y-1 font-mono text-[11px] text-[var(--text-secondary)]">
              <p className={latest.direction === 'long' ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}>
                {latest.direction === 'long' ? 'LONG' : 'SHORT'}
              </p>
              <p>Entry {latest.entryZoneMid?.toFixed(3) ?? '—'}</p>
              <p>RR {(latest.riskRewardRatio ?? 0).toFixed(2)}:1</p>
            </div>
          ) : state ? (
            <div className="mt-4 space-y-1 font-mono text-[11px]">
              <p className="text-[var(--text-secondary)]">No setup detected</p>
              <p className="text-[var(--text-muted)]">
                Price: {state.lastPrice >= 100
                  ? state.lastPrice.toFixed(2)
                  : state.lastPrice.toFixed(4)}
              </p>
              <p className="text-[var(--text-muted)]">
                Scanned: {new Date(state.lastScanned).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UTC
              </p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-[var(--text-muted)]">Run a cycle to scan this asset.</p>
          )}
        </Link>
      ))}
    </div>
  );
}

function AssetStateTimeline({ signal }: { signal: DBSignal | null }) {
  const setupType = signal?.smcSetupJson?.setupType ?? 'none';
  const totalScore = signal?.totalScore ?? 0;

  const states = [
    'Neutral',
    'At Location',
    'Probe / Sweep',
    'Absorption Detected',
    'Confirmation',
    'Executable',
    'Active',
    'Exit / Invalidated',
  ];

  const activeIndex = !signal
    ? 0
    : totalScore >= 75
      ? 5
      : totalScore >= 65
        ? 4
        : setupType.includes('failed_auction')
          ? 3
          : 2;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">AMT Setup State</p>
        <p className="font-mono text-[11px] text-[var(--text-secondary)]">{setupType.replaceAll('_', ' ')}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {states.map((label, index) => (
          <div
            key={label}
            className={[
              'rounded-lg border px-3 py-2 font-mono text-[11px]',
              index <= activeIndex
                ? 'border-[var(--accent-blue)]/35 bg-[var(--accent-blue)]/10 text-[var(--text-primary)]'
                : 'border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]',
            ].join(' ')}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

export function IndicesV2Dashboard({
  section = 'overview',
  asset,
}: {
  section?: AMTSection;
  asset?: string;
}) {
  const [signals, setSignals] = useState<DBSignal[]>([]);
  const [assetStates, setAssetStates] = useState<AssetState[]>([]);
  const [macro, setMacro] = useState<MacroContextData | null>(null);
  const [correlations, setCorrelations] = useState<CorrelationPair[]>([]);
  const [stats, setStats] = useState<PaperStats | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus>(EMPTY_RUNTIME_STATUS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [signalsRes, macroRes, corrRes, statsRes, cycleRes] = await Promise.all([
        fetch('/api/indices/amt/signals', { cache: 'no-store' }),
        fetch('/api/indices/amt/macro', { cache: 'no-store' }),
        fetch('/api/indices/amt/correlation', { cache: 'no-store' }),
        fetch('/api/indices/amt/stats', { cache: 'no-store' }),
        fetch('/api/indices/amt/cycle', { cache: 'no-store' }),
      ]);

      if (!signalsRes.ok || !macroRes.ok || !corrRes.ok || !statsRes.ok || !cycleRes.ok) {
        throw new Error('Failed to refresh AMT dashboard data');
      }

      const signalsPayload = (await signalsRes.json()) as { signals?: DBSignal[]; assetStates?: AssetState[] };
      const macroPayload = (await macroRes.json()) as { macro?: MacroContextData };
      const corrPayload = (await corrRes.json()) as { pairs?: CorrelationPair[] };
      const statsPayload = (await statsRes.json()) as { stats?: PaperStats };
      const cyclePayload = (await cycleRes.json()) as { status?: Partial<RuntimeStatus> };

      const nextSignals = (signalsPayload.signals ?? []).sort((a, b) => a.rank - b.rank);
      setSignals(nextSignals);
      setAssetStates(signalsPayload.assetStates ?? []);
      setMacro(macroPayload.macro ?? null);
      setCorrelations(corrPayload.pairs ?? []);
      setStats(statsPayload.stats ?? null);
      setRuntime({ ...EMPTY_RUNTIME_STATUS, ...(cyclePayload.status ?? {}) });

      setSelectedId(current => {
        if (asset) {
          const assetSignal = nextSignals.find(signal => signal.assetId === asset);
          return assetSignal?.id ?? null;
        }

        if (current && nextSignals.some(signal => signal.id === current)) {
          return current;
        }

        return nextSignals[0]?.id ?? null;
      });

      setError(null);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [asset]);

  useEffect(() => {
    setLoading(true);
    void fetchAll();

    const timer = window.setInterval(() => {
      void fetchAll();
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [fetchAll]);

  const sectionSignals = useMemo(() => {
    if (!isAMTClassSection(section)) {
      return signals;
    }

    return signals.filter(signal => matchesClassSection(section, signal));
  }, [section, signals]);

  const selectedSignal = useMemo(() => {
    if (asset) {
      return sectionSignals.find(signal => signal.assetId === asset) ?? null;
    }

    if (!selectedId) {
      return sectionSignals[0] ?? null;
    }

    return sectionSignals.find(signal => signal.id === selectedId) ?? sectionSignals[0] ?? null;
  }, [asset, selectedId, sectionSignals]);

  const executableCount = sectionSignals.filter(signal => signal.totalScore >= 60).length;
  const lastScanLabel = formatTime(runtime.lastCycleAt);

  const runCycle = useCallback(async () => {
    setRuntime(current => ({ ...current, cycleRunning: true }));
    setError(null);
    try {
      const response = await fetch('/api/indices/amt/cycle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ quick: true }),
      });
      const payload = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;

      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error ?? 'Cycle trigger failed');
      }
      window.setTimeout(() => {
        void fetchAll();
      }, 1200);
    } catch (error) {
      setRuntime(current => ({ ...current, cycleRunning: false }));
      setError(error instanceof Error ? error.message : 'Cycle trigger failed');
    }
  }, [fetchAll]);

  return (
    <div className="min-h-full bg-[var(--bg-primary)] p-4 text-[var(--text-primary)] md:p-6">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6">
        <header className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 md:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-secondary)]">Governance-first runtime</p>
              <h1 className="mt-1 text-xl font-semibold text-[var(--text-primary)] md:text-2xl">AMT {section.toUpperCase()} Workspace</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-secondary)]">
                Runtime {runtime.cycleRunning ? 'Running' : 'Idle'}
              </span>
              <span className="rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-secondary)]">
                Last scan {lastScanLabel}
              </span>
              <button
                type="button"
                onClick={() => void fetchAll()}
                className="rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-primary)] hover:border-[var(--accent-blue)]/40"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void runCycle()}
                disabled={runtime.cycleRunning}
                className="rounded border border-[var(--accent-green)]/40 bg-[var(--accent-green)]/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent-green)] hover:bg-[var(--accent-green)]/25 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {runtime.cycleRunning ? 'Running Cycle...' : 'Run AMT Cycle'}
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">Signals</p>
              <p className="font-mono text-lg text-[var(--text-primary)]">{sectionSignals.length}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">Executable</p>
              <p className="font-mono text-lg text-[var(--accent-green)]">{executableCount}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">Macro Regime</p>
              <p className="font-mono text-sm text-[var(--text-primary)]">{macro ? macro.vix.regime.toUpperCase() : 'N/A'}</p>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-secondary)]">Event Risk</p>
              <p className="font-mono text-sm text-[var(--text-primary)]">{macro?.economicEvents?.length ?? 0} upcoming</p>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-[var(--accent-red)]/40 bg-[var(--accent-red)]/10 p-4 text-sm text-[var(--accent-red)]">{error}</div>
        ) : null}

        {section === 'macro' ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
            <AMTMacroPanel macro={macro} stats={stats} loading={loading} />
          </div>
        ) : null}

        {section === 'correlations' ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
            <CorrelationMatrix pairs={correlations} />
          </div>
        ) : null}

        {section === 'controls' ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">Runtime Controls</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void runCycle()}
                  disabled={runtime.cycleRunning}
                  className="rounded border border-[var(--accent-green)]/40 bg-[var(--accent-green)]/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--accent-green)] hover:bg-[var(--accent-green)]/25 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {runtime.cycleRunning ? 'Cycle in progress' : 'Run AMT Cycle'}
                </button>
                <button
                  type="button"
                  onClick={() => void fetchAll()}
                  className="rounded border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-[var(--text-primary)] hover:border-[var(--accent-blue)]/40"
                >
                  Refresh data
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">Runtime Snapshot</h2>
              <div className="mt-3 space-y-2 font-mono text-xs text-[var(--text-secondary)]">
                <p>Last cycle: {runtime.lastCycleId ?? '—'}</p>
                <p>Executable: {runtime.executableCount}</p>
                <p>Watchlist: {runtime.watchlistCount}</p>
                <p>Status: {runtime.cycleRunning ? 'Running' : 'Idle'}</p>
              </div>
            </div>
          </div>
        ) : null}

        {isAMTClassSection(section) && !asset ? (
          <section className="space-y-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">Class Regime</p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{getClassRegimeTitle(section, macro)}</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Scan the full {section} universe, then open an asset to execute setup logic.
              </p>
            </div>

            <AssetClassGrid section={section} signals={sectionSignals} assetStates={assetStates} />
          </section>
        ) : null}

        {asset ? (
          <section className="grid gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.9fr)_minmax(320px,1fr)]">
            <SignalsPanel
              signals={sectionSignals}
              selectedId={selectedSignal?.id ?? null}
              onSelect={signal => setSelectedId(signal.id)}
              loading={loading}
            />

            <div className="space-y-4">
              {selectedSignal ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                  <SignalDetail signal={selectedSignal} correlations={correlations} />
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6 text-center text-sm text-[var(--text-secondary)]">
                  No signal available yet for {asset}.
                </div>
              )}
              <AssetStateTimeline signal={selectedSignal} />
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                <AMTMacroPanel macro={macro} stats={stats} loading={loading} />
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                <CorrelationMatrix pairs={correlations} />
              </div>
            </div>
          </section>
        ) : null}

        {section === 'overview' ? (
          <section className="grid gap-4 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.5fr)_minmax(320px,1fr)]">
            <SignalsPanel
              signals={sectionSignals}
              selectedId={selectedSignal?.id ?? null}
              onSelect={signal => setSelectedId(signal.id)}
              loading={loading}
            />

            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                {selectedSignal ? (
                  <SignalDetail signal={selectedSignal} correlations={correlations} />
                ) : (
                  <div className="py-8 text-center text-sm text-[var(--text-secondary)]">No ranked signals available.</div>
                )}
              </div>
              <AssetStateTimeline signal={selectedSignal} />
            </div>

            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                <AMTMacroPanel macro={macro} stats={stats} loading={loading} />
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                <h2 className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-secondary)]">Setups by Class</h2>
                <div className="space-y-2">
                  {(Object.keys(AMT_CLASS_ASSETS) as AMTClassSection[]).map(classKey => {
                    const classCount = signals.filter(signal => matchesClassSection(classKey, signal)).length;
                    const classColor: Record<AMTClassSection, string> = {
                      fx: '#3b82f6',
                      indices: '#8b5cf6',
                      commodities: '#f59e0b',
                      rates: '#06b6d4',
                    };
                    const total = Math.max(signals.length, 1);

                    return (
                      <div key={classKey}>
                        <div className="mb-1.5 flex items-center justify-between font-mono text-[10px]">
                          <span className="text-slate-400">{classKey}</span>
                          <span className={['font-bold', statusTone(classCount > 0 ? 65 : 30)].join(' ')}>{classCount}</span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="signal-progress-bar h-full rounded-full"
                            style={{
                              width: `${(classCount / total) * 100}%`,
                              backgroundColor: classColor[classKey],
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
