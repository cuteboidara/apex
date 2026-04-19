'use client';
// src/presentation/indices/components/MacroPanel.tsx
// Displays DXY, VIX, yields, sentiment, and upcoming calendar events

import type { MacroContext } from '@/src/indices/types';

function MetricTile({ label, value, sub, color }: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-[#111] border border-zinc-800 rounded-lg p-3 space-y-0.5">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-sm font-bold ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-400">{sub}</div>}
    </div>
  );
}

const SENTIMENT_COLOR: Record<string, string> = {
  extreme_fear: 'text-red-400',
  fear: 'text-orange-400',
  neutral: 'text-zinc-300',
  greed: 'text-emerald-400',
  extreme_greed: 'text-emerald-300',
};

const VIX_COLOR: Record<string, string> = {
  low: 'text-emerald-400',
  normal: 'text-zinc-300',
  high: 'text-red-400',
};

const IMPACT_COLOR: Record<string, string> = {
  high: 'text-red-400',
  medium: 'text-amber-400',
  low: 'text-zinc-500',
};

export function MacroPanel({ macro }: { macro: MacroContext }) {
  const highImpact = macro.economicEvents.filter(e => e.impact === 'high').slice(0, 5);
  const yieldSign = macro.yield10y.change5d >= 0 ? '+' : '';

  return (
    <div className="space-y-4">
      <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">Macro Context</h3>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile
          label="DXY"
          value={macro.dxy.price.toFixed(2)}
          sub={`${macro.dxy.change24h >= 0 ? '+' : ''}${macro.dxy.change24h.toFixed(2)}% — ${macro.dxy.strength}`}
          color={macro.dxy.strength === 'strong' ? 'text-red-300' : macro.dxy.strength === 'weak' ? 'text-emerald-300' : 'text-zinc-300'}
        />
        <MetricTile
          label="VIX"
          value={macro.vix.price.toFixed(2)}
          sub={macro.vix.regime}
          color={VIX_COLOR[macro.vix.regime]}
        />
        <MetricTile
          label="10Y Yield"
          value={`${macro.yield10y.price.toFixed(2)}%`}
          sub={`${yieldSign}${macro.yield10y.change5d.toFixed(1)}bps 5d — ${macro.yield10y.trend}`}
          color={macro.yield10y.trend === 'up' ? 'text-red-300' : macro.yield10y.trend === 'down' ? 'text-emerald-300' : 'text-zinc-300'}
        />
        <MetricTile
          label="Fear & Greed"
          value={String(macro.sentiment.fearGreed)}
          sub={macro.sentiment.classification.replace(/_/g, ' ')}
          color={SENTIMENT_COLOR[macro.sentiment.classification]}
        />
      </div>

      {highImpact.length > 0 && (
        <div className="bg-[#0d0d0d] border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Upcoming High-Impact Events</div>
          {highImpact.map((event, i) => (
            <div key={i} className="flex items-start justify-between gap-2 text-xs">
              <div>
                <span className={`font-semibold ${IMPACT_COLOR[event.impact]}`}>{event.country}</span>
                <span className="text-zinc-300 ml-1">{event.event}</span>
              </div>
              <span className="text-zinc-500 shrink-0">
                {new Date(event.time).toUTCString().slice(0, 16)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
