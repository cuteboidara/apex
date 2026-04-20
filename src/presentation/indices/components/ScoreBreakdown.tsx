'use client';

import type { DBSignal } from '../types';

type ScoreRow = {
  label: string;
  value: number;
  max: number;
  description: string;
  color: string;
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function computeRows(signal: DBSignal): ScoreRow[] {
  const candleQuality = Math.round((signal.taScore / 30) * 25);
  const orderFlow = Math.round((signal.smcScore / 40) * 25);
  const alignment = Math.round((((signal.smcScore / 40) + (signal.taScore / 30)) / 2) * 20);

  return [
    {
      label: 'Candle Quality',
      value: candleQuality,
      max: 25,
      description: 'Body structure, rejection quality, and session confirmation.',
      color: '#3b82f6',
    },
    {
      label: 'Order Flow',
      value: orderFlow,
      max: 25,
      description: 'Absorption and directional pressure around the setup location.',
      color: '#f59e0b',
    },
    {
      label: 'SMC / TA Alignment',
      value: alignment,
      max: 20,
      description: 'Structure model and technical context agreement.',
      color: '#06b6d4',
    },
    {
      label: 'Macro Adjustment',
      value: signal.macroScore,
      max: 20,
      description: signal.macroSummary ?? 'Macro regime and event-risk adjustment.',
      color: signal.macroScore >= 0 ? '#10b981' : '#ef4444',
    },
    {
      label: 'Correlation Bonus',
      value: signal.quantBonus ?? 0,
      max: 10,
      description: 'Cross-asset correlation confirmation bonus.',
      color: '#8b5cf6',
    },
  ];
}

export function ScoreBreakdown({ signal }: { signal: DBSignal }) {
  const rows = computeRows(signal);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Score Breakdown
        </span>
        <span className={`text-sm font-mono font-bold ${
          signal.totalScore >= 60 ? 'text-emerald-400' : signal.totalScore >= 40 ? 'text-amber-400' : 'text-red-400'
        }`}>
          {signal.totalScore}/100
        </span>
      </div>

      <div className="divide-y divide-slate-800/50">
        {rows.map(row => {
          const pct = clampPercent((Math.abs(row.value) / row.max) * 100);
          const isNegative = row.value < 0;
          return (
            <div key={row.label} className="px-5 py-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-xs text-slate-400">{row.label}</span>
                <span className="font-mono text-sm font-bold" style={{ color: row.color }}>
                  {row.value > 0 ? '+' : ''}{row.value}/{row.max}
                </span>
              </div>

              <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="signal-progress-bar h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: row.color,
                    opacity: isNegative ? 0.6 : 1,
                  }}
                />
              </div>

              <div className="font-mono text-[10px] leading-relaxed text-slate-600">
                {row.description}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-700 bg-slate-800/30 px-5 py-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-bold text-white">Total Score</span>
          <span className={`font-mono text-xl font-bold ${
            signal.totalScore >= 60 ? 'text-emerald-400' : signal.totalScore >= 40 ? 'text-amber-400' : 'text-red-400'
          }`}>
            {signal.totalScore}/100
          </span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            className="signal-progress-bar h-full rounded-full"
            style={{
              width: `${clampPercent(signal.totalScore)}%`,
              background: signal.totalScore >= 60
                ? 'linear-gradient(90deg, #10b981, #34d399)'
                : signal.totalScore >= 40
                  ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
                  : 'linear-gradient(90deg, #ef4444, #f87171)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

