// src/indices/engine/alertFormatter.ts
// Format ranked signals into Telegram + email + dashboard text

import type { RankedSignal, SignalAlert } from '@/src/indices/types';

const RANK_STARS = ['⭐⭐⭐', '⭐⭐', '⭐'];

export function formatSignalAlert(signals: RankedSignal[]): SignalAlert {
  if (signals.length === 0) {
    return {
      timestamp: new Date(),
      signals: [],
      summary: 'No qualifying setups this cycle.',
      telegramText: '🔍 No qualifying setups found this scan cycle.',
      emailSubject: 'Apex — No signals this cycle',
      emailBody: 'No qualifying setups were found this scan cycle.',
    };
  }

  const telegramText = buildTelegramMessage(signals);
  const emailBody = buildEmailBody(signals);

  return {
    timestamp: new Date(),
    signals,
    summary: `${signals.length} signal${signals.length > 1 ? 's' : ''}: ${signals.map(s => `${s.assetId} ${s.direction.toUpperCase()}`).join(', ')}`,
    telegramText,
    emailSubject: `Apex Signal — ${signals[0]!.assetId} ${signals[0]!.direction.toUpperCase()} (${signals[0]!.scores.total}/100)`,
    emailBody,
  };
}

function buildTelegramMessage(signals: RankedSignal[]): string {
  const lines: string[] = [];
  lines.push('🎯 *TRADING SIGNAL — TOP SETUPS*');
  lines.push('');

  for (const signal of signals) {
    const stars = RANK_STARS[signal.rank - 1] ?? '⭐';
    const plan = signal.tradeManagement;
    const ev = signal.quantAnalysis.expectedValue;
    const evStr = ev >= 0 ? `+${ev.toFixed(2)}` : ev.toFixed(2);

    lines.push(`${stars} *RANK ${signal.rank}: ${signal.assetId} ${signal.direction.toUpperCase()}*`);
    lines.push('───────────────────────────');
    lines.push(`Score: *${signal.scores.total}/100*`);
    lines.push(`SMC: ${signal.scores.smc}  | TA: ${signal.scores.ta}  | Macro: ${signal.scores.macro}  | Bonus: ${signal.scores.quantBonus}`);
    lines.push('');
    lines.push(`Setup: ${signal.smcSetup.direction === 'bullish' ? 'Bullish' : 'Bearish'} Order Block Retest`);
    lines.push(`├─ Block Zone: ${fmt(plan.entryZone.low)} — ${fmt(plan.entryZone.high)}`);
    lines.push(`├─ HTF Bias: ${signal.taConfluence.htfBias.combined.replace(/_/g, ' ')}`);
    lines.push(`├─ RSI: ${signal.taConfluence.rsi.value.toFixed(1)} (${signal.taConfluence.rsi.state})`);
    lines.push(`├─ Macro: ${signal.macroSummary}`);

    const corrAligned = signal.correlations.filter(c => c.isAlsoSignaling && c.correlation > 0.4);
    if (corrAligned.length > 0) {
      lines.push(`└─ Correlation: ${corrAligned.map(c => `${c.asset} (${c.correlation.toFixed(2)})`).join(', ')}`);
    }

    lines.push('');
    lines.push('*Trade Plan:*');
    lines.push(`├─ Entry: ${fmt(plan.entryZone.mid)} (limit ${signal.direction})`);
    lines.push(`├─ Stop Loss: ${fmt(plan.stopLoss)}`);
    lines.push(`├─ Take Profit 1: ${fmt(plan.takeProfits.tp1.level)} (close 33%)`);
    lines.push(`├─ Take Profit 2: ${fmt(plan.takeProfits.tp2.level)} (close 33%)`);
    lines.push(`├─ Take Profit 3: ${fmt(plan.takeProfits.tp3.level)} (hold 34%)`);
    lines.push(`└─ Risk: $${signal.riskAmount.toFixed(0)} | Lots: ${signal.positionSize.toFixed(3)} | RR: 1:${plan.riskRewardRatio.toFixed(1)}`);
    lines.push('');
    lines.push(`Historical Win Rate: ${(signal.historicalWinRate * 100).toFixed(0)}% | EV: ${evStr}`);
    lines.push('');

    if (plan.executionNotes.length > 0) {
      lines.push('⚠️ *Execution Notes:*');
      for (const note of plan.executionNotes) {
        lines.push(`• ${note}`);
      }
      lines.push(`• Calendar risk: ${signal.newsRisk.toUpperCase()}`);
    }

    lines.push('');
    lines.push('─────────────────────────────────────────────────');
    lines.push('');
  }

  const nextScan = new Date(Date.now() + 4 * 60 * 60 * 1000);
  lines.push(`═════════════════════════════════════════════════`);
  lines.push(`Next scan: ${nextScan.toUTCString().replace(':00 GMT', ' UTC')}`);

  return lines.join('\n');
}

function buildEmailBody(signals: RankedSignal[]): string {
  // Plain text version of the telegram message (no markdown)
  return buildTelegramMessage(signals)
    .replace(/\*/g, '')
    .replace(/───+/g, '---')
    .replace(/═══+/g, '===');
}

function fmt(price: number): string {
  // Format based on magnitude: indices use 2 decimals, forex 4-5 decimals
  if (price > 100) return price.toFixed(2);
  if (price > 10) return price.toFixed(3);
  return price.toFixed(5);
}
