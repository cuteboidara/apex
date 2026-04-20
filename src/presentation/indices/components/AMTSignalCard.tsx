'use client';

import type { DBSignal } from '../types';

function fmt(price: number | null | undefined): string {
  if (price == null) return '-';
  if (price >= 10000) return price.toFixed(0);
  if (price >= 100) return price.toFixed(2);
  if (price >= 10) return price.toFixed(3);
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

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-emerald-300',
  A: 'text-emerald-400',
  B: 'text-green-400',
  C: 'text-yellow-400',
  D: 'text-orange-400',
  F: 'text-red-400',
};

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  FOREX: { bg: 'bg-blue-500/15', text: 'text-blue-300' },
  INDEX: { bg: 'bg-violet-500/15', text: 'text-violet-300' },
  COMMODITY: { bg: 'bg-amber-500/15', text: 'text-amber-300' },
  RATE: { bg: 'bg-cyan-500/15', text: 'text-cyan-300' },
};

function toCategory(assetClass: string): 'FOREX' | 'INDEX' | 'COMMODITY' | 'RATE' {
  const normalized = assetClass.toLowerCase();
  if (normalized === 'index') return 'INDEX';
  if (normalized === 'commodity') return 'COMMODITY';
  if (normalized === 'rate') return 'RATE';
  return 'FOREX';
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
  const category = toCategory(signal.assetClass);
  const catStyle = CATEGORY_STYLES[category];
  const grade = getGrade(signal.totalScore);
  const gradeColor = GRADE_COLORS[grade] ?? 'text-slate-400';
  const isLong = signal.direction === 'long';
  const statusLabel = signal.totalScore >= 60 ? 'EXECUTABLE' : signal.totalScore >= 40 ? 'WATCHLIST' : 'SKIP';
  const statusStyle = signal.totalScore >= 60
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : signal.totalScore >= 40
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
      : 'bg-slate-800 text-slate-500 border-slate-700';
  const entry = signal.entryZoneMid ?? 0;
  const rr = signal.riskRewardRatio ?? 0;
  const newsRisk = signal.newsRisk.toLowerCase();

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border p-5 text-left transition-all duration-150 ${
        selected
          ? 'border-cyan-500/50 bg-cyan-500/5 shadow-[0_0_0_1px_rgba(6,182,212,0.3)]'
          : 'border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900'
      }`}
    >
      <div className="mb-4 flex items-center justify-between">
        <span className={`rounded px-2 py-0.5 text-[10px] font-mono font-medium ${catStyle.bg} ${catStyle.text}`}>
          {category}
        </span>
        <span className={`rounded border px-2 py-0.5 text-[10px] font-mono ${statusStyle}`}>
          {statusLabel}
        </span>
      </div>

      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xl font-mono font-bold tracking-tight text-white">{signal.assetId}</span>
        <span className={`text-sm font-mono font-semibold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
          {isLong ? 'UP LONG' : 'DN SHORT'}
        </span>
      </div>

      <div className="mb-4 text-[10px] font-mono text-slate-600">RANK #{signal.rank}</div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-slate-800/50 p-3">
          <div className="mb-1 text-[9px] font-mono uppercase text-slate-500">Grade</div>
          <div className={`text-2xl font-mono font-bold ${gradeColor}`}>{grade}</div>
        </div>
        <div className="rounded-lg bg-slate-800/50 p-3">
          <div className="mb-1 text-[9px] font-mono uppercase text-slate-500">Score</div>
          <div className="text-2xl font-mono font-bold text-white">
            {signal.totalScore}
            <span className="text-sm text-slate-500">/100</span>
          </div>
        </div>
      </div>

      <div className="flex justify-between border-t border-slate-800 pt-3 text-xs font-mono">
        <span className="text-slate-500">
          Entry <span className="text-slate-300">{fmt(entry)}</span>
        </span>
        <span className="text-slate-500">
          RR <span className="text-slate-300">{rr.toFixed(2)}:1</span>
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[9px] font-mono uppercase text-slate-600">News Risk</span>
        <span className={`text-[9px] font-mono uppercase ${
          newsRisk === 'clear' ? 'text-emerald-500'
            : newsRisk === 'caution' ? 'text-amber-500'
              : 'text-red-500'
        }`}>
          {newsRisk}
        </span>
      </div>
    </button>
  );
}

