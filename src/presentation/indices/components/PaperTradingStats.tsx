'use client';

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

function StatCell({
  label,
  value,
  unit,
  sub,
  color = 'text-white',
}: {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="p-4">
      <div className="mb-2 font-mono text-[9px] uppercase text-slate-600">{label}</div>
      <div className={`text-2xl font-mono font-bold ${color}`}>
        {value}
        {unit && <span className="ml-0.5 text-sm text-slate-500">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 font-mono text-[10px] text-slate-600">{sub}</div>}
    </div>
  );
}

export function PaperTradingStats({ stats }: { stats: PaperStats | null }) {
  if (!stats) {
    return (
      <div className="rounded-xl border border-slate-800 px-5 py-6 text-center font-mono text-xs text-slate-500">
        No paper trading data yet
      </div>
    );
  }

  const totalSignals = Math.max(stats.totalSignals, 0);
  const executablePct = totalSignals > 0
    ? Math.round((stats.executableSignals / totalSignals) * 100)
    : 0;

  const topAsset = Object.entries(stats.byAsset).sort((a, b) => b[1] - a[1])[0];
  const topSetup = Object.entries(stats.bySetup).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800">
      <div className="border-b border-slate-800 px-5 py-3">
        <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
          Paper Trading Stats
        </span>
      </div>

      <div className="grid grid-cols-2 divide-x divide-y divide-slate-800">
        <StatCell label="Total Signals" value={totalSignals} />
        <StatCell
          label="Avg Score"
          value={stats.avgScore.toFixed(1)}
          unit="/100"
          color={stats.avgScore >= 60 ? 'text-emerald-400' : 'text-amber-400'}
        />
        <StatCell
          label="Executable"
          value={stats.executableSignals}
          sub={`${executablePct}%`}
          color="text-emerald-400"
        />
        <StatCell
          label="Watchlist"
          value={stats.watchlistSignals}
          sub="40-59 score"
          color="text-amber-400"
        />
      </div>

      <div className="border-t border-slate-800 px-5 py-4">
        <div className="mb-2 flex items-center justify-between font-mono text-[10px]">
          <span className="text-emerald-400">LONG {stats.longPct}%</span>
          <span className="text-slate-500">Bias</span>
          <span className="text-red-400">SHORT {stats.shortPct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-red-950/40">
          <div className="signal-progress-bar h-full rounded-full bg-emerald-500/70" style={{ width: `${Math.max(0, Math.min(100, stats.longPct))}%` }} />
        </div>
      </div>

      <div className="border-t border-slate-800 bg-slate-900/50 px-5 py-3">
        <div className="mb-1 font-mono text-[9px] text-slate-600">Most active</div>
        <div className="font-mono text-xs text-slate-300">
          <span className="font-bold text-white">{topAsset?.[0] ?? 'N/A'}</span>
          {' '}
          ({topAsset?.[1] ?? 0} signals)
          {' · '}
          Top: {(topSetup?.[0] ?? 'N/A').replace(/_/g, ' ')}
        </div>
      </div>
    </div>
  );
}

