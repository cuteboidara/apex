'use client';
// src/presentation/indices/components/AMTMacroPanel.tsx
// Middle column: live macro data + paper trading stats

import type { MacroContextData } from '../types';
import type { PaperStats } from './StatsGrid';
import { StatsGrid } from './StatsGrid';

function MacroTile({
  label, value, sub, valueColor,
}: {
  label: string; value: string; sub?: string; valueColor?: string;
}) {
  return (
    <div className="space-y-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">{label}</div>
      <div className={`font-mono text-base font-bold ${valueColor ?? 'text-white'}`}>{value}</div>
      {sub && <div className="font-mono text-[11px] text-[var(--text-secondary)]">{sub}</div>}
    </div>
  );
}

const SENTIMENT_COLOR: Record<string, string> = {
  extreme_fear: 'text-red-400',
  fear:         'text-orange-400',
  neutral:      'text-slate-300',
  greed:        'text-emerald-400',
  extreme_greed:'text-emerald-300',
};

const VIX_COLOR = { low: 'text-emerald-400', normal: 'text-slate-300', high: 'text-red-400' };

export function AMTMacroPanel({
  macro,
  stats,
  loading,
}: {
  macro: MacroContextData | null;
  stats: PaperStats | null;
  loading: boolean;
}) {
  if (loading || !macro) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-4 w-24 rounded bg-[var(--bg-tertiary)]" />
        <div className="grid grid-cols-2 gap-2">
          {[1,2,3,4].map(i => <div key={i} className="h-14 rounded-lg bg-[var(--bg-tertiary)]" />)}
        </div>
      </div>
    );
  }

  const dxyUp = macro.dxy.change24h >= 0;
  const yieldSign = macro.yield10y.change5d >= 0 ? '+' : '';
  const highImpact = macro.economicEvents.filter(e => e.impact === 'high').slice(0, 3);

  return (
    <div className="space-y-5">
      {/* Macro metrics */}
      <div>
        <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
          Live Macro
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MacroTile
            label="DXY"
            value={macro.dxy.price.toFixed(2)}
            sub={`${dxyUp ? '▲' : '▼'} ${Math.abs(macro.dxy.change24h).toFixed(2)}% · ${macro.dxy.strength}`}
            valueColor={macro.dxy.strength === 'strong' ? 'text-red-300' : macro.dxy.strength === 'weak' ? 'text-emerald-300' : 'text-slate-200'}
          />
          <MacroTile
            label="VIX"
            value={macro.vix.price.toFixed(2)}
            sub={macro.vix.regime}
            valueColor={VIX_COLOR[macro.vix.regime]}
          />
          <MacroTile
            label="10Y Yield"
            value={`${macro.yield10y.price.toFixed(2)}%`}
            sub={`${yieldSign}${macro.yield10y.change5d.toFixed(1)}bps · ${macro.yield10y.trend}`}
            valueColor={macro.yield10y.trend === 'up' ? 'text-red-300' : macro.yield10y.trend === 'down' ? 'text-emerald-300' : 'text-slate-200'}
          />
          <MacroTile
            label="Fear & Greed"
            value={String(macro.sentiment.fearGreed)}
            sub={macro.sentiment.classification.replace(/_/g, ' ')}
            valueColor={SENTIMENT_COLOR[macro.sentiment.classification]}
          />
        </div>
      </div>

      {/* AMT Bias indicator */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] p-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">AMT Macro Bias</div>
        <div className="flex items-center gap-3 font-mono text-xs">
          <span className="text-[var(--text-secondary)]">DXY</span>
          <span className={macro.dxy.trend === 'down' ? 'text-[var(--accent-green)]' : macro.dxy.trend === 'up' ? 'text-[var(--accent-red)]' : 'text-[var(--text-secondary)]'}>
            {macro.dxy.trend === 'down' ? '↓ Bearish USD' : macro.dxy.trend === 'up' ? '↑ Bullish USD' : '→ Neutral'}
          </span>
          <span className="text-[var(--text-muted)]">|</span>
          <span className="text-[var(--text-secondary)]">Risk</span>
          <span className={macro.vix.regime === 'low' ? 'text-[var(--accent-green)]' : macro.vix.regime === 'high' ? 'text-[var(--accent-red)]' : 'text-slate-300'}>
            {macro.vix.regime === 'low' ? 'On' : macro.vix.regime === 'high' ? 'Off' : 'Neutral'}
          </span>
          <span className="text-[var(--text-muted)]">|</span>
          <span className="text-[var(--text-secondary)]">Sentiment</span>
          <span className={SENTIMENT_COLOR[macro.sentiment.classification]}>
            {macro.sentiment.classification.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {/* Economic calendar */}
      {highImpact.length > 0 && (
        <div className="space-y-2">
          <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            High-Impact Events
          </div>
          <div className="space-y-1.5">
            {highImpact.map((event, i) => (
              <div key={i} className="flex items-start justify-between gap-2 rounded-lg border border-[var(--accent-red)]/30 bg-[var(--accent-red)]/10 px-3 py-2 font-mono text-xs">
                <div>
                  <span className="font-semibold text-[var(--accent-red)]">{event.country}</span>
                  <span className="ml-1.5 text-slate-300">{event.event}</span>
                </div>
                <span className="shrink-0 text-[var(--text-secondary)]">
                  {new Date(event.time).toUTCString().slice(0, 16)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Paper trading stats */}
      <div className="border-t border-[var(--border)] pt-4">
        <StatsGrid stats={stats} />
      </div>
    </div>
  );
}
