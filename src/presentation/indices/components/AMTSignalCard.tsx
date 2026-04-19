'use client';
// src/presentation/indices/components/AMTSignalCard.tsx
// Compact card for a single AMT signal (as stored in IndicesSignal table)

import type { DBSignal } from '../types';

function fmt(price: number | null | undefined): string {
  if (price == null) return '—';
  if (price >= 10000) return price.toFixed(0);
  if (price >= 100)   return price.toFixed(2);
  if (price >= 10)    return price.toFixed(3);
  return price.toFixed(5);
}

function getGrade(score: number): string {
  if (score >= 90) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}

const CATEGORY_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  index:     { text: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
  forex:     { text: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/30'   },
  commodity: { text: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/30'  },
  rate:      { text: 'text-cyan-400',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/30'   },
};

function getCategoryStyle(assetClass: string) {
  return CATEGORY_COLORS[assetClass.toLowerCase()] ?? CATEGORY_COLORS['forex']!;
}

export function AMTSignalCard({
  signal,
  selected,
  onClick,
}: {
  signal: DBSignal;
  selected?: boolean;
  onClick?: () => void;
}) {
  const executable = signal.totalScore >= 70;
  const directionLabel = signal.direction === 'long' ? '↑ LONG' : '↓ SHORT';
  const assetClass = signal.assetClass.toUpperCase();
  const catStyle = getCategoryStyle(signal.assetClass);

  return (
    <div
      onClick={onClick}
      className={[
        'cursor-pointer rounded-lg border bg-[var(--bg-secondary)] p-6 transition-all',
        selected
          ? 'border-[var(--accent-blue)]/50 shadow-[0_0_0_1px_rgba(88,166,255,0.2)]'
          : 'border-[var(--border)] hover:border-[var(--accent-blue)]/30',
      ].join(' ')}
    >
      <div className="mb-4 flex items-center justify-between">
        <span className={[
          'rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest',
          catStyle.text, catStyle.bg,
        ].join(' ')}>
          {assetClass}
        </span>
        <span
          className={[
            'rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
            executable
              ? 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
              : 'border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]',
          ].join(' ')}
        >
          {executable ? 'EXECUTABLE' : 'WATCHLIST'}
        </span>
      </div>

      <div className="mb-1 font-mono text-2xl font-bold text-[var(--text-primary)]">
        {signal.assetId}
      </div>

      <div
        className={[
          'font-mono text-sm',
          signal.direction === 'long' ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]',
        ].join(' ')}
      >
        {directionLabel}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            BEST GRADE
          </div>
          <div className="font-mono text-lg font-bold text-[var(--text-primary)]">
            {getGrade(signal.totalScore)}
          </div>
        </div>
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
            SCORE
          </div>
          <div className="font-mono text-lg font-bold text-[var(--text-primary)]">
            {signal.totalScore}/100
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-1">
        <div className="font-mono text-[11px] text-[var(--text-secondary)]">
          Entry: {fmt(signal.entryZoneMid)}
        </div>
        <div className="font-mono text-[11px] text-[var(--text-secondary)]">
          RR: {(signal.riskRewardRatio ?? 0).toFixed(2)}:1
        </div>
        <div className="font-mono text-[11px] text-[var(--text-muted)]">
          Rank: #{signal.rank}
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-3">
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
          <span>News Risk</span>
          <span
            className={
              signal.newsRisk === 'clear'
                ? 'text-[var(--accent-green)]'
                : signal.newsRisk === 'caution'
                  ? 'text-[var(--accent-yellow)]'
                  : 'text-[var(--accent-red)]'
            }
          >
            {signal.newsRisk}
          </span>
        </div>
      </div>
    </div>
  );
}
