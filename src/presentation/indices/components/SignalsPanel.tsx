'use client';
// src/presentation/indices/components/SignalsPanel.tsx
// Left column: top 3 ranked AMT signals

import type { DBSignal } from '../types';
import { AMTSignalCard } from './AMTSignalCard';

export function SignalsPanel({
  signals,
  selectedId,
  onSelect,
  loading,
}: {
  signals: DBSignal[];
  selectedId: string | null;
  onSelect: (signal: DBSignal) => void;
  loading: boolean;
}) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <div className="mb-3 flex items-center justify-between border-b border-[var(--border)] pb-3">
        <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
          SIGNALS
        </div>
        {signals.length > 0 && (
          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            {signals.some(s => s.totalScore >= 70) && (
              <span className="rounded border border-[var(--accent-green)]/30 bg-[var(--accent-green)]/10 px-1.5 py-0.5 text-[var(--accent-green)]">
                {signals.filter(s => s.totalScore >= 70).length} exec
              </span>
            )}
            <span className="text-[var(--text-secondary)]">
              {signals.length} total
            </span>
          </div>
        )}
      </div>

      {loading && (
        <div className="flex flex-1 items-center justify-center">
          <div className="font-mono text-xs text-[var(--text-muted)]">Loading signals...</div>
        </div>
      )}

      {!loading && signals.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center space-y-2">
            <div className="font-mono text-xs text-[var(--text-secondary)]">No signals this cycle</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]">All assets below threshold</div>
          </div>
        </div>
      )}

      {!loading && signals.length > 0 && (
        <div className="space-y-3 overflow-y-auto pr-1">
          {signals.map(signal => (
            <AMTSignalCard
              key={signal.id}
              signal={signal}
              selected={selectedId === signal.id}
              onClick={() => onSelect(signal)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
