// src/indices/alerts/formatter.ts
// Format AMT cycle results for Telegram and email

import type { AMTSignal, AMTCycleResult } from '@/src/indices/types/amtTypes';

// ─── Helpers ───────────────────────────────────────────────────────────────

const SETUP_LABELS: Record<string, string> = {
  failed_auction_long: '🔄 Failed Auction ▲',
  failed_auction_short: '🔄 Failed Auction ▼',
  breakout_acceptance: '🚀 Breakout Acceptance',
};

const DIRECTION_ICON: Record<string, string> = {
  long: '🟢',
  short: '🔴',
};

const NEWS_RISK_ICON: Record<string, string> = {
  clear: '✅',
  caution: '⚠️',
  blocked: '🚫',
};

const RANK_LABEL: Record<number, string> = {
  1: '🥇 #1',
  2: '🥈 #2',
  3: '🥉 #3',
};

function formatPrice(v: number): string {
  if (v >= 1000) return v.toFixed(1);
  if (v >= 10) return v.toFixed(3);
  return v.toFixed(5);
}

function formatScore(score: number): string {
  const blocks = Math.round(score / 10);
  const filled = '█'.repeat(blocks);
  const empty = '░'.repeat(10 - blocks);
  return `${filled}${empty} ${score}/100`;
}

function formatScoreBreakdown(s: AMTSignal): string {
  return [
    `  Candle quality:  ${s.candleQuality.toFixed(0)}/25`,
    `  Order flow:      ${s.orderFlowConfidence.toFixed(0)}/25`,
    `  SMC/TA align:    ${s.smcTaAlignment.toFixed(0)}/20`,
    `  Macro adj:       ${s.macroAdjustment > 0 ? '+' : ''}${s.macroAdjustment.toFixed(0)}`,
    `  Corr bonus:      +${s.correlationBonus.toFixed(0)}/10`,
  ].join('\n');
}

// ─── Single Signal ─────────────────────────────────────────────────────────

function formatSignal(signal: AMTSignal): string {
  const rankLabel = RANK_LABEL[signal.rank] ?? `#${signal.rank}`;
  const dirIcon = DIRECTION_ICON[signal.direction];
  const setupLabel = SETUP_LABELS[signal.setupType] ?? signal.setupType;
  const newsIcon = NEWS_RISK_ICON[signal.newsRisk];

  return [
    `${rankLabel} — ${signal.assetId} ${dirIcon} ${signal.direction.toUpperCase()}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 Setup: ${setupLabel}`,
    `📈 Score: ${formatScore(signal.totalScore)}`,
    ``,
    `Score breakdown:`,
    formatScoreBreakdown(signal),
    ``,
    `📍 Fair Value Area:`,
    `  Upper: ${formatPrice(signal.fairValueArea.upper)}`,
    `  VWAP:  ${formatPrice(signal.fairValueArea.center)}`,
    `  Lower: ${formatPrice(signal.fairValueArea.lower)}`,
    `  Strength: ${signal.fairValueArea.strength}% candles inside`,
    `  Price is: ${signal.priceRelativeToFVA} FVA`,
    ``,
    `🎯 Trade Levels:`,
    `  Entry zone: ${formatPrice(signal.entryZone.low)} – ${formatPrice(signal.entryZone.high)}`,
    `  Stop loss:  ${formatPrice(signal.stopLoss)}`,
    `  TP1 (1:1): ${formatPrice(signal.tp1)}`,
    `  TP2 (1:2): ${formatPrice(signal.tp2)}`,
    `  TP3 (1:3): ${formatPrice(signal.tp3)}`,
    `  RR ratio:  1:${signal.riskRewardRatio.toFixed(1)}`,
    ``,
    `💰 Sizing:`,
    `  Lots: ${signal.positionSize.toFixed(2)} | Risk: $${signal.riskAmount.toFixed(0)}`,
    `  Kelly: ${(signal.kellyFraction * 100).toFixed(1)}% (half)`,
    ``,
    `📋 Setup:`,
    `  ${signal.setupDescription}`,
    ``,
    `✅ Confirmation:`,
    signal.confirmationEvidence.map(e => `  • ${e}`).join('\n'),
    ``,
    `🌍 Macro: ${signal.macroContext}`,
    `🗓️  News risk: ${newsIcon} ${signal.newsRisk}`,
    ``,
    `⚡ Plan: ${signal.executionPlan}`,
    `❌ Invalidation: ${formatPrice(signal.invalidationLevel)}`,
  ].join('\n');
}

// ─── Cycle Summary ─────────────────────────────────────────────────────────

function formatRegimeSummary(result: AMTCycleResult): string {
  const r = result.regime;
  return [
    `📊 Market Regime`,
    `  DXY: ${r.dxy.value.toFixed(2)} (${r.dxy.trend.replace('_', ' ')}, ${r.dxy.change24h > 0 ? '+' : ''}${r.dxy.change24h.toFixed(2)}%)`,
    `  VIX: ${r.vix.value.toFixed(1)} (${r.vix.regime} regime)`,
    `  10Y: ${r.yields.value.toFixed(2)}% yield (${r.yields.trend})`,
    `  Sentiment: ${r.sentiment.fearGreed}/100 — ${r.sentiment.bias.replace('_', ' ')}`,
    `  Calendar: ${r.calendar.eventRisk}${r.calendar.nextEvent ? ` | next: ${r.calendar.nextEvent.event}` : ''}`,
    `  Combined adj: ${r.combinedAdjustment > 0 ? '+' : ''}${r.combinedAdjustment}`,
  ].join('\n');
}

// ─── Main Formatter ────────────────────────────────────────────────────────

export interface FormattedAlert {
  telegramMessages: string[];   // split for Telegram 4096 char limit
  emailSubject: string;
  emailBody: string;
  summary: string;
}

/**
 * Format an AMT cycle result into Telegram messages and email.
 */
export function formatAMTAlert(result: AMTCycleResult): FormattedAlert {
  const { signals, executable, watchlist, cycleId, generatedAt } = result;

  const timestamp = generatedAt.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZoneName: 'short',
  });

  // ── Build full Telegram body ──────────────────────────────────────────
  const lines: string[] = [
    `🏦 *APEX AMT SIGNALS* | ${timestamp}`,
    `Cycle: \`${cycleId}\``,
    ``,
  ];

  if (signals.length === 0) {
    lines.push('⏸️ No qualifying setups this cycle.');
    lines.push('All assets below minimum score threshold.');
  } else {
    lines.push(
      `${executable.length > 0 ? `✅ ${executable.length} executable` : '⏸️ 0 executable'} | ` +
      `${watchlist.length > 0 ? `👀 ${watchlist.length} watchlist` : '0 watchlist'}`,
    );
    lines.push('');

    if (executable.length > 0) {
      lines.push('━━ EXECUTABLE SETUPS ━━');
      lines.push('');
      for (const s of executable) {
        lines.push(formatSignal(s));
        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
      }
    }

    if (watchlist.length > 0) {
      lines.push('━━ WATCHLIST ━━');
      lines.push('');
      for (const s of watchlist) {
        lines.push(formatSignal(s));
        lines.push('');
        lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━');
        lines.push('');
      }
    }
  }

  lines.push('');
  lines.push(formatRegimeSummary(result));
  lines.push('');
  lines.push(`⏱️ Next scan: ${result.nextCycleAt.toLocaleTimeString()}`);
  lines.push(`_Generated by Apex AMT Engine_`);

  const fullText = lines.join('\n');

  // Split into Telegram chunks (max 4096 chars)
  const telegramMessages = splitTelegram(fullText);

  // ── Summary ────────────────────────────────────────────────────────────
  const summary =
    signals.length === 0
      ? 'No setups this cycle'
      : `${executable.length} executable, ${watchlist.length} watchlist: ` +
        signals.map(s => `${s.assetId} ${s.direction} (${s.totalScore})`).join(', ');

  // ── Email ──────────────────────────────────────────────────────────────
  const topAssets = signals.slice(0, 3).map(s => s.assetId).join(', ') || 'None';
  const emailSubject = `Apex AMT — ${executable.length} Executable | ${topAssets}`;
  const emailBody = fullText
    .replace(/\*/g, '')   // strip Telegram bold
    .replace(/`/g, '')    // strip code formatting
    .replace(/_/g, '');   // strip italic

  return {
    telegramMessages,
    emailSubject,
    emailBody,
    summary,
  };
}

function splitTelegram(text: string, maxLen = 4096): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Find last newline before limit
    const slice = remaining.slice(0, maxLen);
    const splitAt = slice.lastIndexOf('\n');
    const cutAt = splitAt > 0 ? splitAt : maxLen;

    chunks.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }

  return chunks;
}
