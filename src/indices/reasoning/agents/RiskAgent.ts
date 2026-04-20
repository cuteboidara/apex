import { BaseAgent } from './BaseAgent';

import type { AgentContext, RiskOutput } from '../types';

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean);
}

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export class RiskAgent extends BaseAgent<RiskOutput> {
  systemPrompt(): string {
    return [
      'You are a skeptical trading risk manager.',
      'Your task is to find reasons NOT to take the trade and protect capital.',
      'Return strict JSON only.',
    ].join(' ');
  }

  userPrompt(context: AgentContext): string {
    const { signal, marketData, recentSignals = [] } = context;
    const recentLossCount = recentSignals.filter(row => row.outcome === 'loss').length;
    const recentWinCount = recentSignals.filter(row => row.outcome === 'win').length;
    const atr = this.calculateATR(marketData.recentCandles.slice(-14));
    const slDistance = Math.abs(signal.entryZone.mid - signal.stopLoss);

    return `
Challenge this trade setup and report risk concerns.

Trade:
- Asset: ${signal.assetId}
- Direction: ${signal.direction.toUpperCase()}
- Entry: ${signal.entryZone.mid}
- Stop Loss: ${signal.stopLoss}
- Stop Distance: ${slDistance.toFixed(5)}
- RR: ${signal.riskRewardRatio}:1
- AMT Score: ${signal.totalScore}/100

Recent Performance:
- Recent signals reviewed: ${recentSignals.length}
- Wins: ${recentWinCount}
- Losses: ${recentLossCount}
- Win rate: ${recentSignals.length > 0 ? Math.round((recentWinCount / recentSignals.length) * 100) : 0}%

Volatility:
- ATR(14): ${atr.toFixed(5)}
- Stop vs ATR: ${this.getStopDistanceVsAtr(slDistance, atr)}

Return EXACT JSON:
{
  "riskScore": <number from 0 to 10>,
  "warnings": ["<warning>"],
  "criticalConcerns": ["<critical concern>"],
  "suggestedSlAdjustment": {
    "shouldAdjust": <boolean>,
    "newStopLoss": <number or null>,
    "reason": "<why>"
  },
  "shouldBlock": <boolean>,
  "summary": "<one paragraph>"
}
`.trim();
  }

  private calculateATR(candles: Array<{ high: number; low: number; close: number }>): number {
    if (candles.length < 2) return 0;

    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i += 1) {
      const current = candles[i];
      const previous = candles[i - 1];
      trueRanges.push(
        Math.max(
          current.high - current.low,
          Math.abs(current.high - previous.close),
          Math.abs(current.low - previous.close),
        ),
      );
    }

    return trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
  }

  private getStopDistanceVsAtr(stopDistance: number, atr: number): string {
    if (atr <= 0) return 'unknown';
    const ratio = stopDistance / atr;
    if (ratio < 0.5) return 'too tight (<0.5x ATR)';
    if (ratio < 1) return 'tight (0.5-1.0x ATR)';
    if (ratio < 2) return 'reasonable (1.0-2.0x ATR)';
    return 'wide (>2.0x ATR)';
  }

  parseResponse(responseText: string, context: AgentContext): RiskOutput {
    try {
      const parsed = this.parseJsonRecord(responseText);
      const suggestedSlAdjustment = (parsed.suggestedSlAdjustment ?? {}) as Record<string, unknown>;

      return {
        riskScore: Math.max(0, Math.min(10, Math.round(toNumber(parsed.riskScore, 5)))),
        warnings: toStringArray(parsed.warnings).slice(0, 8),
        criticalConcerns: toStringArray(parsed.criticalConcerns).slice(0, 6),
        suggestedSlAdjustment: {
          shouldAdjust: toBool(suggestedSlAdjustment.shouldAdjust, false),
          newStopLoss: suggestedSlAdjustment.newStopLoss == null
            ? null
            : toNumber(suggestedSlAdjustment.newStopLoss, context.signal.stopLoss),
          reason: toStringValue(suggestedSlAdjustment.reason, 'No adjustment required'),
        },
        shouldBlock: toBool(parsed.shouldBlock, false),
        summary: toStringValue(parsed.summary, 'Risk output unavailable'),
      };
    } catch (error) {
      console.error('[RiskAgent] Parse error:', error);
      return {
        riskScore: 5,
        warnings: ['Risk analysis failed'],
        criticalConcerns: [],
        suggestedSlAdjustment: {
          shouldAdjust: false,
          newStopLoss: null,
          reason: 'Fallback',
        },
        shouldBlock: false,
        summary: 'Risk output unavailable.',
      };
    }
  }
}
