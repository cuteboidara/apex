'use client';
// src/presentation/indices/components/CorrelationMatrix.tsx
// Visual 7x7 correlation heatmap

interface CorrelationPair {
  asset1: string;
  asset2: string;
  correlation: number;
}

const ASSETS = ['NAS100', 'SPX500', 'DAX', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'];

function corrColor(corr: number): string {
  if (corr >= 0.7) return 'bg-[var(--accent-green)]/30 text-[#d2f7dd]';
  if (corr >= 0.4) return 'bg-[var(--accent-green)]/15 text-[var(--accent-green)]';
  if (corr <= -0.7) return 'bg-[var(--accent-red)]/30 text-[#ffd9d7]';
  if (corr <= -0.4) return 'bg-[var(--accent-red)]/15 text-[var(--accent-red)]';
  return 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]';
}

export function CorrelationMatrix({ pairs }: { pairs: CorrelationPair[] }) {
  function getCorr(a: string, b: string): number {
    if (a === b) return 1;
    return pairs.find(p =>
      (p.asset1 === a && p.asset2 === b) || (p.asset1 === b && p.asset2 === a),
    )?.correlation ?? 0;
  }

  return (
    <div className="space-y-3">
      <h3 className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-secondary)]">Correlation Matrix (30d)</h3>
      <div className="overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="w-16 p-1" />
              {ASSETS.map(a => (
                <th key={a} className="w-14 p-1 text-center font-mono text-[10px] font-normal uppercase tracking-wider text-[var(--text-secondary)]">
                  {a.replace('USD', '')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ASSETS.map(rowAsset => (
              <tr key={rowAsset}>
                <td className="p-1 pr-2 text-right font-mono text-[10px] font-medium uppercase tracking-wider text-[var(--text-secondary)]">{rowAsset.replace('USD', '')}</td>
                {ASSETS.map(colAsset => {
                  const corr = getCorr(rowAsset, colAsset);
                  return (
                    <td key={colAsset} className={`rounded p-1 text-center font-mono text-[11px] ${corrColor(corr)}`}>
                      {rowAsset === colAsset ? '—' : corr.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-[var(--accent-green)]/30" /> Strong positive</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-[var(--bg-tertiary)]" /> Weak</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-[var(--accent-red)]/30" /> Strong negative</span>
      </div>
    </div>
  );
}
