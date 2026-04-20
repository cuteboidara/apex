import { BaseAgent } from './BaseAgent';

import type { AgentContext, AnalystOutput } from '../types';

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean);
}

function toStringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export class AnalystAgent extends BaseAgent<AnalystOutput> {
  systemPrompt(): string {
    return [
      'You are an expert price action analyst specializing in Auction Market Theory (AMT) and Smart Money Concepts (SMC).',
      'Analyze why the setup formed and return strict JSON only.',
      'Be objective and include weaknesses, not just strengths.',
    ].join(' ');
  }

  userPrompt(context: AgentContext): string {
    const { signal, marketData } = context;
    const candles = marketData.recentCandles.slice(-5);
    const candleRows = candles.length === 0
      ? 'No candle data available.'
      : candles.map((candle, index) => (
        `Candle ${index + 1}: O:${candle.open.toFixed(5)} H:${candle.high.toFixed(5)} `
        + `L:${candle.low.toFixed(5)} C:${candle.close.toFixed(5)} V:${candle.volume.toFixed(2)}`
      )).join('\n');

    return `
Analyze this AMT setup and explain why it formed.

Setup:
- Asset: ${signal.assetId}
- Setup Type: ${signal.setupType}
- Direction: ${signal.direction}
- AMT Score: ${signal.totalScore}/100
- Entry Zone: ${signal.entryZone.low} - ${signal.entryZone.high}
- Stop Loss: ${signal.stopLoss}
- TP1: ${signal.tp1} | TP2: ${signal.tp2} | TP3: ${signal.tp3}
- RR: ${signal.riskRewardRatio}:1

Score Breakdown:
- Candle Quality: ${signal.candleQuality}/25
- Order Flow: ${signal.orderFlowConfidence}/25
- SMC/TA Alignment: ${signal.smcTaAlignment}/20
- Macro Adjustment: ${signal.macroAdjustment}/20
- Correlation Bonus: ${signal.correlationBonus}/10

Recent Price Context:
${candleRows}

Return EXACT JSON:
{
  "conviction": <number from -10 to +10>,
  "summary": "<one paragraph>",
  "strengths": ["<strength>"],
  "weaknesses": ["<weakness>"],
  "keyLevels": {
    "criticalSupport": <number>,
    "criticalResistance": <number>,
    "invalidationPrice": <number>
  }
}
`.trim();
  }

  parseResponse(responseText: string, context: AgentContext): AnalystOutput {
    try {
      const parsed = this.parseJsonRecord(responseText);
      const keyLevels = (parsed.keyLevels ?? {}) as Record<string, unknown>;

      return {
        conviction: Math.max(-10, Math.min(10, Math.round(toNumber(parsed.conviction, 0)))),
        summary: toStringValue(parsed.summary, 'No analyst summary generated'),
        strengths: toStringArray(parsed.strengths).slice(0, 6),
        weaknesses: toStringArray(parsed.weaknesses).slice(0, 6),
        keyLevels: {
          criticalSupport: toNumber(keyLevels.criticalSupport, context.signal.entryZone.low),
          criticalResistance: toNumber(keyLevels.criticalResistance, context.signal.entryZone.high),
          invalidationPrice: toNumber(keyLevels.invalidationPrice, context.signal.stopLoss),
        },
      };
    } catch (error) {
      console.error('[AnalystAgent] Parse error:', error);
      return {
        conviction: 0,
        summary: 'Analyst output unavailable.',
        strengths: [],
        weaknesses: ['Agent parsing error'],
        keyLevels: {
          criticalSupport: context.signal.entryZone.low,
          criticalResistance: context.signal.entryZone.high,
          invalidationPrice: context.signal.stopLoss,
        },
      };
    }
  }
}
