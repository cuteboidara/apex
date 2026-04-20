'use client';

import type { CorrelationPair, DBSignal } from '../types';
import { ReasoningPanel } from './ReasoningPanel';
import { ScoreBreakdown } from './ScoreBreakdown';
import { TradingViewChart } from './TradingViewChart';

function fmt(price: number | null | undefined): string {
  if (price == null) return '-';
  if (price >= 10000) return price.toFixed(0);
  if (price >= 100) return price.toFixed(2);
  if (price >= 10) return price.toFixed(3);
  return price.toFixed(5);
}

function pctFromEntry(entry: number | null, target: number | null): number {
  if (entry == null || target == null || entry === 0) return 0;
  return (Math.abs(target - entry) / Math.abs(entry)) * 100;
}

function distance(entry: number | null, stop: number | null): string {
  if (entry == null || stop == null) return '-';
  return Math.abs(entry - stop).toFixed(entry >= 100 ? 2 : 5);
}

function styleForCorr(value: number): string {
  if (value >= 0.7) return 'text-emerald-300';
  if (value >= 0.4) return 'text-emerald-400';
  if (value <= -0.7) return 'text-red-300';
  if (value <= -0.4) return 'text-red-400';
  return 'text-slate-400';
}

export function SignalDetail({
  signal,
  correlations,
}: {
  signal: DBSignal;
  correlations: CorrelationPair[];
}) {
  const entryMid = signal.entryZoneMid;
  const tp1Pct = pctFromEntry(entryMid, signal.tp1);
  const tp2Pct = pctFromEntry(entryMid, signal.tp2);
  const tp3Pct = pctFromEntry(entryMid, signal.tp3);

  const setupType = signal.smcSetupJson?.setupType ?? 'unknown';
  const relevantCorr = correlations
    .filter(pair => pair.asset1 === signal.assetId || pair.asset2 === signal.assetId)
    .map(pair => ({
      asset: pair.asset1 === signal.assetId ? pair.asset2 : pair.asset1,
      value: pair.correlation,
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 5);

  return (
    <div className="signal-panel">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-2xl font-bold text-white">{signal.assetId}</span>
        <span className={`rounded px-2 py-0.5 font-mono text-xs font-semibold ${
          signal.direction === 'long' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
        }`}>
          {signal.direction === 'long' ? 'UP LONG' : 'DN SHORT'}
        </span>
        <span className="font-mono text-xs uppercase text-slate-500">{setupType.replace(/_/g, ' ')}</span>
      </div>

      {signal.reasoning ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Setup Context</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{signal.reasoning}</p>
          {signal.macroSummary ? (
            <p className="mt-2 text-xs font-mono text-slate-500">{signal.macroSummary}</p>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div>
          <div className="mb-4 rounded-xl border border-slate-800 p-5">
            <div className="mb-4 font-mono text-[10px] uppercase tracking-widest text-slate-500">
              Entry Zone
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="mb-1 font-mono text-[9px] text-slate-600">LOW</div>
                <div className="font-mono text-base text-slate-300">{fmt(signal.entryZoneLow)}</div>
              </div>
              <div className="text-center">
                <div className="mb-1 font-mono text-[9px] text-slate-600">ENTRY (MID)</div>
                <div className="font-mono text-xl font-bold text-white">{fmt(signal.entryZoneMid)}</div>
              </div>
              <div className="text-right">
                <div className="mb-1 font-mono text-[9px] text-slate-600">HIGH</div>
                <div className="font-mono text-base text-slate-300">{fmt(signal.entryZoneHigh)}</div>
              </div>
            </div>

            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="signal-progress-bar h-full rounded-full bg-gradient-to-r from-cyan-500/40 via-cyan-400 to-cyan-500/40" style={{ width: '100%' }} />
            </div>
          </div>

          <div className="mb-4 rounded-xl border border-red-900/30 bg-red-950/10 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="mb-1 font-mono text-[10px] uppercase tracking-widest text-red-500/70">
                  Stop Loss
                </div>
                <div className="font-mono text-2xl font-bold text-red-400">
                  {fmt(signal.stopLoss)}
                </div>
              </div>
              <div className="text-right">
                <div className="mb-1 font-mono text-[9px] text-slate-600">DISTANCE</div>
                <div className="font-mono text-sm text-red-400/70">{distance(signal.entryZoneMid, signal.stopLoss)}</div>
              </div>
            </div>
          </div>

          <div className="mb-4 overflow-hidden rounded-xl border border-slate-800">
            <div className="border-b border-slate-800 px-5 py-3">
              <div className="font-mono text-[10px] uppercase tracking-widest text-slate-500">Take Profits</div>
            </div>

            {[
              {
                label: 'TP1',
                value: signal.tp1,
                pct: tp1Pct,
                action: 'Close 33% · Move SL breakeven',
                color: 'text-emerald-400',
                barColor: 'bg-emerald-500/30',
              },
              {
                label: 'TP2',
                value: signal.tp2,
                pct: tp2Pct,
                action: 'Close 33% · Move SL to entry',
                color: 'text-emerald-300',
                barColor: 'bg-emerald-500/50',
              },
              {
                label: 'TP3',
                value: signal.tp3,
                pct: tp3Pct,
                action: 'Trail 34% · 2x ATR stop',
                color: 'text-emerald-200',
                barColor: 'bg-emerald-400/70',
              },
            ].map((tp, index) => (
              <div
                key={tp.label}
                className={`flex items-center gap-4 px-5 py-4 ${
                  index < 2 ? 'border-b border-slate-800/50' : ''
                }`}
              >
                <div className="w-8 font-mono text-[10px] text-slate-500">{tp.label}</div>

                <div className="flex-1">
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className={`font-mono text-base font-semibold ${tp.color}`}>
                      {fmt(tp.value)}
                    </span>
                    <span className="font-mono text-xs text-slate-500">+{tp.pct.toFixed(2)}%</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-slate-800">
                    <div className={`signal-progress-bar h-full rounded-full ${tp.barColor}`} style={{ width: `${Math.min(tp.pct * 20, 100)}%` }} />
                  </div>
                </div>

                <div className="w-36 text-right font-mono text-[9px] leading-relaxed text-slate-600">
                  {tp.action}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-800 p-4 text-center">
              <div className="mb-1 font-mono text-[9px] uppercase text-slate-600">RR Ratio</div>
              <div className="font-mono text-xl font-bold text-white">1:{(signal.riskRewardRatio ?? 0).toFixed(1)}</div>
            </div>
            <div className="rounded-xl border border-slate-800 p-4 text-center">
              <div className="mb-1 font-mono text-[9px] uppercase text-slate-600">Position</div>
              <div className="font-mono text-xl font-bold text-white">
                {(signal.positionSize ?? 0).toFixed(2)}
                <span className="ml-1 text-xs text-slate-500">lots</span>
              </div>
            </div>
            <div className="rounded-xl border border-red-900/20 bg-red-950/5 p-4 text-center">
              <div className="mb-1 font-mono text-[9px] uppercase text-red-500/60">Risk $</div>
              <div className="font-mono text-xl font-bold text-red-400">${Math.round(signal.riskAmount ?? 0)}</div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <button className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-6 py-3.5 text-sm font-mono text-slate-300 transition-colors hover:border-slate-500 hover:text-white">
              <span>Edit Levels</span>
            </button>
            <button className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-sm font-mono font-bold text-black transition-colors hover:bg-emerald-400">
              <span>Execute</span>
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <ScoreBreakdown signal={signal} />

          {relevantCorr.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-800">
              <div className="border-b border-slate-800 px-5 py-3">
                <span className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  Correlation Context
                </span>
              </div>
              <div className="space-y-0.5 px-5 py-4">
                {relevantCorr.map(item => (
                  <div key={item.asset} className="flex items-center justify-between py-1.5">
                    <span className="font-mono text-xs text-slate-400">{item.asset}</span>
                    <span className={`font-mono text-xs font-bold ${styleForCorr(item.value)}`}>
                      {item.value > 0 ? '+' : ''}{item.value.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="pt-2">
        <div className="mb-3 font-mono text-xs font-semibold uppercase tracking-wider text-slate-400">
          Live Chart - {signal.assetId} 4H
        </div>
        <TradingViewChart
          symbol={signal.assetId}
          interval="240"
          height={480}
          signal={
            signal.entryZoneHigh != null &&
            signal.entryZoneLow != null &&
            signal.stopLoss != null &&
            signal.tp1 != null &&
            signal.tp2 != null &&
            signal.tp3 != null
              ? {
                entryHigh: signal.entryZoneHigh,
                entryLow: signal.entryZoneLow,
                stopLoss: signal.stopLoss,
                tp1: signal.tp1,
                tp2: signal.tp2,
                tp3: signal.tp3,
                direction: signal.direction,
              }
              : undefined
          }
        />
      </div>

      <div className="pt-2">
        <div className="mb-3 font-mono text-[10px] uppercase tracking-widest text-slate-500">
          AI Agent Reasoning
        </div>
        <ReasoningPanel signalId={signal.id} />
      </div>
    </div>
  );
}
