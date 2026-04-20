import { BaseAgent } from './BaseAgent';

import type { AgentContext, MacroOutput } from '../types';

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

function toNewsLevel(value: unknown): 'clear' | 'caution' | 'high' {
  if (value === 'clear' || value === 'caution' || value === 'high') {
    return value;
  }
  return 'clear';
}

export class MacroAgent extends BaseAgent<MacroOutput> {
  systemPrompt(): string {
    return [
      'You are a macro strategist focused on validating whether macro context supports this trade.',
      'Evaluate DXY, VIX, yields, sentiment, and event risk.',
      'Return strict JSON only.',
    ].join(' ');
  }

  userPrompt(context: AgentContext): string {
    const { signal, macroContext } = context;
    const eventLines = macroContext.economicEvents.slice(0, 5).map(event => (
      `- ${event.country}: ${event.event} (${event.impact}, ${event.time.toISOString()})`
    ));

    return `
Assess whether macro conditions support this trade.

Trade:
- ${signal.assetId} ${signal.direction.toUpperCase()}

Macro Snapshot:
- DXY: ${macroContext.dxy.price} (${macroContext.dxy.trend})
- VIX: ${macroContext.vix.price} (${macroContext.vix.regime})
- US10Y: ${macroContext.yield10y.price}% (${macroContext.yield10y.trend})
- Fear & Greed: ${macroContext.sentiment.fearGreed}/100 (${macroContext.sentiment.classification})

Upcoming Events (24h):
${eventLines.length > 0 ? eventLines.join('\n') : '- None listed'}

Correlation Notes:
${this.getRelevantCorrelations(signal.assetId)}

Return EXACT JSON:
{
  "alignmentScore": <number from -10 to +10>,
  "supportingFactors": ["<factor>"],
  "conflictingFactors": ["<factor>"],
  "newsRisk": {
    "level": "clear" | "caution" | "high",
    "blockingEvents": ["<event name>"]
  },
  "regimeContext": "<one sentence>",
  "summary": "<one paragraph>"
}
`.trim();
  }

  private getRelevantCorrelations(assetId: string): string {
    const correlations: Record<string, string> = {
      EURUSD: '- EURUSD vs DXY: inverse bias\n- EURUSD vs Gold: positive risk-on tendency',
      USDJPY: '- USDJPY vs US10Y: positive bias\n- USDJPY vs risk sentiment: positive in risk-on',
      NAS100: '- NAS100 vs US10Y: inverse bias\n- NAS100 vs DXY: often inverse',
      SPX500: '- SPX500 vs VIX: strong inverse\n- SPX500 vs DXY: mild inverse',
      XAUUSD: '- Gold vs DXY: inverse bias\n- Gold vs real yields: inverse',
    };

    return correlations[assetId] ?? '- Use cross-asset dashboard matrix';
  }

  parseResponse(responseText: string, _context: AgentContext): MacroOutput {
    try {
      const parsed = this.parseJsonRecord(responseText);
      const newsRisk = (parsed.newsRisk ?? {}) as Record<string, unknown>;

      return {
        alignmentScore: Math.max(-10, Math.min(10, Math.round(toNumber(parsed.alignmentScore, 0)))),
        supportingFactors: toStringArray(parsed.supportingFactors).slice(0, 6),
        conflictingFactors: toStringArray(parsed.conflictingFactors).slice(0, 6),
        newsRisk: {
          level: toNewsLevel(newsRisk.level),
          blockingEvents: toStringArray(newsRisk.blockingEvents).slice(0, 5),
        },
        regimeContext: toStringValue(parsed.regimeContext, 'Macro regime unavailable'),
        summary: toStringValue(parsed.summary, 'Macro output unavailable'),
      };
    } catch (error) {
      console.error('[MacroAgent] Parse error:', error);
      return {
        alignmentScore: 0,
        supportingFactors: [],
        conflictingFactors: [],
        newsRisk: {
          level: 'clear',
          blockingEvents: [],
        },
        regimeContext: 'Macro output unavailable',
        summary: 'Macro output unavailable.',
      };
    }
  }
}
