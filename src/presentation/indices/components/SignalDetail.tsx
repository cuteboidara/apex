'use client';
// src/presentation/indices/components/SignalDetail.tsx
// Full expanded breakdown of a selected AMT signal

import type { DBSignal, CorrelationPair } from '../types';
import { TradingViewChart } from './TradingViewChart';

function fmt(price: number | null | undefined, digits?: number): string {
  if (price == null) return '—';
  if (digits !== undefined) return price.toFixed(digits);
  if (price >= 10000) return price.toFixed(0);
  if (price >= 100)   return price.toFixed(2);
  if (price >= 10)    return price.toFixed(3);
  return price.toFixed(5);
}

function ScoreRow({
  label, value, max, description,
}: {
  label: string; value: number; max: number; description?: string;
}) {
  const pct = Math.max(0, Math.min(100, (Math.abs(value) / max) * 100));
  const isNeg = value < 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className={`font-mono font-semibold ${isNeg ? 'text-red-400' : 'text-slate-200'}`}>
          {isNeg ? '' : '+'}{value}/{max}
        </span>
      </div>
      <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${isNeg ? 'bg-red-500' : pct >= 75 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-sky-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {description && <div className="text-xs text-slate-500">{description}</div>}
    </div>
  );
}

function TPRow({ label, price, entry, actionNote }: {
  label: string; price: number | null; entry: number | null; actionNote: string;
}) {
  if (price == null || entry == null) return null;
  const diff = Math.abs(price - entry);
  const pctGain = (diff / Math.abs(entry)) * 100;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-8 text-slate-400 font-medium">{label}</span>
      <span className="font-mono text-emerald-300 w-24">{fmt(price)}</span>
      <span className="text-slate-500 text-xs">+{pctGain.toFixed(2)}%</span>
      <span className="flex-1 text-xs text-slate-400">{actionNote}</span>
    </div>
  );
}

export function SignalDetail({
  signal,
  correlations,
}: {
  signal: DBSignal;
  correlations: CorrelationPair[];
}) {
  const setupType = (signal.smcSetupJson as { setupType?: string } | null)?.setupType ?? '—';

  // Find correlations involving this asset
  const relevantCorr = correlations
    .filter(p => p.asset1 === signal.assetId || p.asset2 === signal.assetId)
    .map(p => ({
      other: p.asset1 === signal.assetId ? p.asset2 : p.asset1,
      value: p.correlation,
    }))
    .filter(c => Math.abs(c.value) >= 0.5)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-xl font-bold ${signal.direction === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>
              {signal.assetId}
            </span>
            <span className={`text-sm px-2 py-0.5 rounded font-semibold ${signal.direction === 'long' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-red-400/15 text-red-300'}`}>
              {signal.direction === 'long' ? '↑ LONG' : '↓ SHORT'}
            </span>
            <span className="text-sm text-slate-400">{setupType.replace(/_/g, ' ')}</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Score: <span className="text-white font-bold">{signal.totalScore}/100</span>
            {' · '}Cycle: <span className="text-slate-400">{signal.cycleId}</span>
          </div>
        </div>
      </div>

      {/* Setup description */}
      {signal.reasoning && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="text-xs text-slate-500 uppercase tracking-wider mb-2">Setup Description</div>
          <p className="text-sm text-slate-200 leading-relaxed">{signal.reasoning}</p>
          {signal.macroSummary && (
            <p className="text-xs text-slate-400 mt-2">{signal.macroSummary}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trade Management */}
        <div className="space-y-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Trade Management</div>

          {/* Entry zone */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-2">
            <div className="text-xs text-slate-500 mb-3">Entry Zone</div>
            <div className="grid grid-cols-3 gap-2 text-sm text-center">
              <div>
                <div className="text-xs text-slate-500">Low</div>
                <div className="font-mono text-slate-300">{fmt(signal.entryZoneLow)}</div>
              </div>
              <div className="border-x border-slate-700">
                <div className="text-xs text-slate-500">Mid (entry)</div>
                <div className="font-mono text-white font-semibold">{fmt(signal.entryZoneMid)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">High</div>
                <div className="font-mono text-slate-300">{fmt(signal.entryZoneHigh)}</div>
              </div>
            </div>
          </div>

          {/* Stop loss */}
          <div className="flex items-center justify-between text-sm bg-red-950/30 border border-red-900/40 rounded-xl px-4 py-3">
            <span className="text-red-400 font-medium">Stop Loss</span>
            <span className="font-mono text-red-300 font-bold">{fmt(signal.stopLoss)}</span>
          </div>

          {/* Take profits */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-3">
            <div className="text-xs text-slate-500 mb-1">Take Profits</div>
            <TPRow label="TP1" price={signal.tp1} entry={signal.entryZoneMid} actionNote="Close 33% · Move SL to breakeven" />
            <TPRow label="TP2" price={signal.tp2} entry={signal.entryZoneMid} actionNote="Close 33% · Move SL to entry" />
            <TPRow label="TP3" price={signal.tp3} entry={signal.entryZoneMid} actionNote="Trail 34% · 2× ATR stop" />
          </div>

          {/* Size + risk */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-3">
              <div className="text-xs text-slate-500">RR Ratio</div>
              <div className="text-lg font-bold text-white font-mono">1:{(signal.riskRewardRatio ?? 0).toFixed(1)}</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-3">
              <div className="text-xs text-slate-500">Position</div>
              <div className="text-lg font-bold text-white font-mono">{(signal.positionSize ?? 0).toFixed(3)}</div>
              <div className="text-xs text-slate-500">lots</div>
            </div>
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-3">
              <div className="text-xs text-slate-500">Risk $</div>
              <div className="text-lg font-bold text-amber-300 font-mono">${(signal.riskAmount ?? 0).toFixed(0)}</div>
            </div>
          </div>
        </div>

        {/* Score Breakdown + Correlations */}
        <div className="space-y-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Score Breakdown</div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-4">
            <ScoreRow
              label="Candle Quality"
              value={signal.taScore}
              max={25}
              description="4H candle direction, body strength, wick rejection"
            />
            <ScoreRow
              label="Order Flow"
              value={Math.round(signal.smcScore)}
              max={25}
              description="Buyer/seller aggression at FVA boundary"
            />
            <ScoreRow
              label="SMC / TA Alignment"
              value={signal.smcScore > 12 ? Math.round(signal.smcScore - 12) : 0}
              max={20}
              description="Order block + HTF structural alignment"
            />
            <ScoreRow
              label="Macro Adjustment"
              value={signal.macroScore}
              max={20}
              description="DXY, VIX, yields, sentiment, calendar risk"
            />
            <ScoreRow
              label="Correlation Bonus"
              value={signal.quantBonus}
              max={10}
              description="Correlated assets confirming same direction"
            />

            <div className="border-t border-slate-700 pt-3 flex items-center justify-between">
              <span className="text-sm text-slate-400">Total Score</span>
              <span className={`text-xl font-bold font-mono ${signal.totalScore >= 70 ? 'text-emerald-400' : signal.totalScore >= 50 ? 'text-amber-400' : 'text-slate-400'}`}>
                {signal.totalScore}/100
              </span>
            </div>
          </div>

          {/* Correlations */}
          {relevantCorr.length > 0 && (
            <>
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Correlation Context</div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-3">
                {relevantCorr.map(c => {
                  const isPositive = c.value > 0;
                  const strength = Math.abs(c.value) >= 0.7 ? 'Strong' : 'Moderate';
                  return (
                    <div key={c.other} className="flex items-center justify-between text-xs">
                      <div>
                        <span className="text-slate-300 font-medium">{signal.assetId}</span>
                        <span className="text-slate-500 mx-1">↔</span>
                        <span className="text-slate-300 font-medium">{c.other}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono font-semibold ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                          {isPositive ? '+' : ''}{c.value.toFixed(2)}
                        </span>
                        <span className="text-slate-500">
                          {strength} {isPositive ? 'positive' : 'inverse'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <button className="flex-1 text-xs py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors">
              ✏️ Edit Levels
            </button>
            <button className="flex-1 text-xs py-2 rounded-lg bg-emerald-800/50 hover:bg-emerald-700/50 text-emerald-300 border border-emerald-700/50 transition-colors font-semibold">
              ▶ Execute
            </button>
          </div>
        </div>
      </div>

      {/* ── Live TradingView chart ── */}
      <div className="pt-2">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          Live Chart — {signal.assetId} 4H
        </div>
        <TradingViewChart
          symbol={signal.assetId}
          interval="240"
          height={480}
          signal={
            signal.entryZoneHigh != null &&
            signal.entryZoneLow  != null &&
            signal.stopLoss      != null &&
            signal.tp1           != null &&
            signal.tp2           != null &&
            signal.tp3           != null
              ? {
                  entryHigh:  signal.entryZoneHigh,
                  entryLow:   signal.entryZoneLow,
                  stopLoss:   signal.stopLoss,
                  tp1:        signal.tp1,
                  tp2:        signal.tp2,
                  tp3:        signal.tp3,
                  direction:  signal.direction,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
