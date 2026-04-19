'use client';

import type { RankedSignal } from '@/src/indices/types';

function fmt(price: number | null | undefined): string {
  if (price == null) return '—';
  if (price > 100) return price.toFixed(2);
  if (price > 10) return price.toFixed(3);
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

export function SignalCard({ signal }: { signal: RankedSignal }) {
  const executable = signal.scores.total >= 70;

  return (
    <div className="cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-6 transition-all hover:border-[var(--accent-blue)]/30">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">FOREX</span>
        <span
          className={[
            'rounded border px-2 py-0.5 font-mono text-[10px]',
            executable
              ? 'border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 text-[var(--accent-green)]'
              : 'border-[var(--accent-yellow)]/30 bg-[var(--accent-yellow)]/10 text-[var(--accent-yellow)]',
          ].join(' ')}
        >
          {executable ? 'EXECUTABLE' : 'WATCHLIST'}
        </span>
      </div>

      <div className="mb-1 font-mono text-2xl font-bold text-[var(--text-primary)]">{signal.assetId}</div>

      <div className={`font-mono text-sm ${signal.direction === 'long' ? 'text-[var(--accent-green)]' : 'text-[var(--accent-red)]'}`}>
        {signal.direction === 'long' ? '↑ LONG' : '↓ SHORT'}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase text-[var(--text-secondary)]">BEST GRADE</div>
          <div className="font-mono text-lg font-bold">{getGrade(signal.scores.total)}</div>
        </div>
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase text-[var(--text-secondary)]">SCORE</div>
          <div className="font-mono text-lg font-bold">{signal.scores.total}/100</div>
        </div>
      </div>

      <div className="mt-4 font-mono text-[11px] text-[var(--text-secondary)]">
        Entry: {fmt(signal.tradeManagement.entryZone.mid)}
      </div>
      <div className="font-mono text-[11px] text-[var(--text-secondary)]">
        RR: {signal.tradeManagement.riskRewardRatio.toFixed(2)}:1
      </div>
    </div>
  );
}
