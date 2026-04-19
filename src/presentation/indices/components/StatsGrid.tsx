'use client';
// src/presentation/indices/components/StatsGrid.tsx
// Paper trading statistics summary

export interface PaperStats {
  totalSignals: number;
  executableSignals: number;
  watchlistSignals: number;
  avgScore: number;
  longPct: number;
  shortPct: number;
  byAsset: Record<string, number>;
  bySetup: Record<string, number>;
}

function StatTile({
  label,
  value,
  unit,
  color,
  subtext,
}: {
  label: string;
  value: string | number;
  unit?: string;
  color?: string;
  subtext?: string;
}) {
  return (
    <div className="space-y-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">{label}</div>
      <div className={`text-base font-bold font-mono ${color ?? 'text-white'}`}>
        {value}{unit && <span className="ml-0.5 text-xs font-normal text-[var(--text-secondary)]">{unit}</span>}
      </div>
      {subtext && <div className="font-mono text-[11px] text-[var(--text-secondary)]">{subtext}</div>}
    </div>
  );
}

export function StatsGrid({ stats }: { stats: PaperStats | null }) {
  if (!stats) {
    return (
      <div className="py-4 text-center font-mono text-xs text-[var(--text-secondary)]">
        No paper trading data yet
      </div>
    );
  }

  const execPct = stats.totalSignals > 0
    ? Math.round((stats.executableSignals / stats.totalSignals) * 100)
    : 0;

  const topAsset = Object.entries(stats.byAsset).sort((a, b) => b[1] - a[1])[0];
  const topSetup = Object.entries(stats.bySetup).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="space-y-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">
        Paper Trading Stats
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label="Total Signals"
          value={stats.totalSignals}
          color="text-white"
        />
        <StatTile
          label="Avg Score"
          value={stats.avgScore.toFixed(1)}
          unit="/100"
          color={stats.avgScore >= 65 ? 'text-emerald-400' : stats.avgScore >= 50 ? 'text-amber-400' : 'text-slate-300'}
        />
        <StatTile
          label="Executable"
          value={stats.executableSignals}
          unit={` (${execPct}%)`}
          color="text-emerald-400"
          subtext="≥60 score"
        />
        <StatTile
          label="Watchlist"
          value={stats.watchlistSignals}
          color="text-amber-400"
          subtext="40–59 score"
        />
        <StatTile
          label="Long Bias"
          value={`${stats.longPct}%`}
          color={stats.longPct > 60 ? 'text-emerald-400' : stats.longPct < 40 ? 'text-red-400' : 'text-slate-300'}
        />
        <StatTile
          label="Short Bias"
          value={`${stats.shortPct}%`}
          color={stats.shortPct > 60 ? 'text-red-400' : 'text-slate-300'}
        />
      </div>

      {topAsset && (
        <div className="font-mono text-[11px] text-[var(--text-secondary)]">
          Most active: <span className="font-medium text-slate-300">{topAsset[0]}</span>
          {' '}({topAsset[1]} signals)
          {topSetup && (
            <> · Top setup: <span className="text-slate-300">{topSetup[0].replace(/_/g, ' ')}</span></>
          )}
        </div>
      )}
    </div>
  );
}
