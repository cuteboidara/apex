'use client';

import type { MacroContextData } from '../types';
import { PaperTradingStats, type PaperStats } from './PaperTradingStats';

function MacroTile({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 p-4">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`font-mono text-xl font-bold ${valueColor ?? 'text-white'}`}>{value}</div>
      {sub ? <div className="mt-1 font-mono text-[11px] text-slate-500">{sub}</div> : null}
    </div>
  );
}

const SENTIMENT_COLOR: Record<string, string> = {
  extreme_fear: 'text-red-400',
  fear: 'text-orange-400',
  neutral: 'text-slate-300',
  greed: 'text-emerald-400',
  extreme_greed: 'text-emerald-300',
};

const VIX_COLOR: Record<string, string> = {
  low: 'text-emerald-400',
  normal: 'text-slate-300',
  high: 'text-red-400',
};

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
        <div className="h-4 w-24 rounded bg-slate-800" />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(item => (
            <div key={item} className="h-20 rounded-xl bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  const dxyUp = macro.dxy.change24h >= 0;
  const yieldSign = macro.yield10y.change5d >= 0 ? '+' : '';
  const highImpact = macro.economicEvents.filter(event => event.impact === 'high').slice(0, 6);

  return (
    <div className="space-y-5">
      <div>
        <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Live Macro
        </div>
        <div className="grid grid-cols-2 gap-3">
          <MacroTile
            label="DXY"
            value={macro.dxy.price.toFixed(2)}
            sub={`${dxyUp ? '+' : '-'}${Math.abs(macro.dxy.change24h).toFixed(2)}% · ${macro.dxy.strength}`}
            valueColor={macro.dxy.strength === 'strong' ? 'text-red-300' : macro.dxy.strength === 'weak' ? 'text-emerald-300' : 'text-white'}
          />
          <MacroTile
            label="VIX"
            value={macro.vix.price.toFixed(2)}
            sub={macro.vix.regime}
            valueColor={VIX_COLOR[macro.vix.regime] ?? 'text-white'}
          />
          <MacroTile
            label="10Y Yield"
            value={`${macro.yield10y.price.toFixed(2)}%`}
            sub={`${yieldSign}${macro.yield10y.change5d.toFixed(1)}bps · ${macro.yield10y.trend}`}
            valueColor={macro.yield10y.trend === 'up' ? 'text-red-300' : macro.yield10y.trend === 'down' ? 'text-emerald-300' : 'text-white'}
          />
          <MacroTile
            label="Fear & Greed"
            value={String(macro.sentiment.fearGreed)}
            sub={macro.sentiment.classification.replace(/_/g, ' ')}
            valueColor={SENTIMENT_COLOR[macro.sentiment.classification] ?? 'text-white'}
          />
        </div>
      </div>

      <PaperTradingStats stats={stats} />

      {highImpact.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
          <div className="border-b border-slate-800 px-5 py-3">
            <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
              High-Impact Events
            </span>
          </div>
          <div className="divide-y divide-slate-800/50">
            {highImpact.map((event, index) => (
              <div key={`${event.country}-${event.event}-${index}`} className="flex items-center gap-3 px-5 py-3">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold ${
                  event.country === 'JP' ? 'bg-red-900/30 text-red-400'
                    : event.country === 'CA' ? 'bg-red-800/30 text-red-300'
                      : 'bg-slate-800 text-slate-400'
                }`}>
                  {event.country}
                </span>
                <span className="flex-1 truncate font-mono text-xs text-slate-300">
                  {event.event}
                </span>
                <span className="whitespace-nowrap font-mono text-[10px] text-slate-600">
                  {new Date(event.time).toISOString().slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

