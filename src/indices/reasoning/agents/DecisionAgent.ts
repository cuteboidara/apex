import { BaseAgent } from './BaseAgent';

import type {
  AgentContext,
  AnalystOutput,
  DecisionAction,
  DecisionOutput,
  MacroOutput,
  RiskOutput,
} from '../types';

interface DecisionContext extends AgentContext {
  analystOutput: AnalystOutput;
  riskOutput: RiskOutput;
  macroOutput: MacroOutput;
}

const DECISION_MODEL = (process.env.LLM_DECISION_MODEL ?? 'claude-opus-4-7').trim() || 'claude-opus-4-7';

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

function toAction(value: unknown): DecisionAction {
  return value === 'EXECUTE' || value === 'WATCH' || value === 'SKIP' ? value : 'WATCH';
}

function toGrade(value: unknown): DecisionOutput['tradeQualityGrade'] {
  if (value === 'A+' || value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'F') {
    return value;
  }
  return 'C';
}

function toConsensus(value: unknown): DecisionOutput['agentConsensus'] {
  if (value === 'aligned' || value === 'conflicted' || value === 'split') {
    return value;
  }
  return 'split';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class DecisionAgent extends BaseAgent<DecisionOutput, DecisionContext> {
  constructor() {
    super(DECISION_MODEL);
  }

  systemPrompt(): string {
    return [
      'You are the head trader making the final trade decision.',
      'Synthesize analyst, risk, and macro outputs.',
      'Use action: EXECUTE, WATCH, or SKIP.',
      'Return strict JSON only.',
    ].join(' ');
  }

  userPrompt(context: DecisionContext): string {
    const { signal, analystOutput, riskOutput, macroOutput } = context;

    return `
Make the final decision for this setup.

Original Signal:
- Asset: ${signal.assetId}
- Direction: ${signal.direction.toUpperCase()}
- Score: ${signal.totalScore}/100
- Setup: ${signal.setupType}
- RR: ${signal.riskRewardRatio}:1

Analyst:
- Conviction: ${analystOutput.conviction}/10
- Summary: ${analystOutput.summary}
- Strengths: ${(analystOutput.strengths ?? []).join(', ')}
- Weaknesses: ${(analystOutput.weaknesses ?? []).join(', ')}

Risk:
- Risk Score: ${riskOutput.riskScore}/10
- Should Block: ${riskOutput.shouldBlock}
- Critical Concerns: ${(riskOutput.criticalConcerns ?? []).join(', ') || 'None'}
- Warnings: ${(riskOutput.warnings ?? []).join(', ') || 'None'}
- Summary: ${riskOutput.summary}

Macro:
- Alignment: ${macroOutput.alignmentScore}/10
- Supporting: ${(macroOutput.supportingFactors ?? []).join(', ') || 'None'}
- Conflicting: ${(macroOutput.conflictingFactors ?? []).join(', ') || 'None'}
- News Risk: ${macroOutput.newsRisk.level}
- Regime: ${macroOutput.regimeContext}

Rules:
- If risk says shouldBlock true, prefer SKIP unless overwhelming positives.
- If macro news risk is high, avoid EXECUTE.
- Score delta must be between -20 and +20.

Return EXACT JSON:
{
  "action": "EXECUTE" | "WATCH" | "SKIP",
  "scoreDelta": <number -20 to +20>,
  "finalScore": <number>,
  "confidence": <number 0-100>,
  "primaryReasoning": "<one paragraph>",
  "keyFactors": {
    "supporting": ["<factor>"],
    "opposing": ["<factor>"]
  },
  "executionGuidance": {
    "useOriginalLevels": <boolean>,
    "adjustedStopLoss": <number or null>,
    "scaleInRecommended": <boolean>,
    "monitorFor": ["<item>"]
  },
  "agentConsensus": "aligned" | "conflicted" | "split",
  "tradeQualityGrade": "A+" | "A" | "B" | "C" | "D" | "F"
}
`.trim();
  }

  parseResponse(responseText: string, context: DecisionContext): DecisionOutput {
    const baseScore = context.signal.totalScore;
    try {
      const parsed = this.parseJsonRecord(responseText);
      const keyFactors = (parsed.keyFactors ?? {}) as Record<string, unknown>;
      const executionGuidance = (parsed.executionGuidance ?? {}) as Record<string, unknown>;

      const scoreDelta = clamp(Math.round(toNumber(parsed.scoreDelta, 0)), -20, 20);
      const finalScore = clamp(
        Math.round(toNumber(parsed.finalScore, baseScore + scoreDelta)),
        0,
        100,
      );

      return {
        action: toAction(parsed.action),
        scoreDelta,
        finalScore,
        confidence: clamp(Math.round(toNumber(parsed.confidence, 50)), 0, 100),
        primaryReasoning: toStringValue(parsed.primaryReasoning, 'Decision output unavailable'),
        keyFactors: {
          supporting: toStringArray(keyFactors.supporting).slice(0, 6),
          opposing: toStringArray(keyFactors.opposing).slice(0, 6),
        },
        executionGuidance: {
          useOriginalLevels: toBool(executionGuidance.useOriginalLevels, true),
          adjustedStopLoss: executionGuidance.adjustedStopLoss == null
            ? null
            : toNumber(executionGuidance.adjustedStopLoss, context.signal.stopLoss),
          scaleInRecommended: toBool(executionGuidance.scaleInRecommended, false),
          monitorFor: toStringArray(executionGuidance.monitorFor).slice(0, 6),
        },
        agentConsensus: toConsensus(parsed.agentConsensus),
        tradeQualityGrade: toGrade(parsed.tradeQualityGrade),
      };
    } catch (error) {
      console.error('[DecisionAgent] Parse error:', error);
      return {
        action: 'WATCH',
        scoreDelta: 0,
        finalScore: Math.round(baseScore),
        confidence: 50,
        primaryReasoning: 'Decision output unavailable.',
        keyFactors: {
          supporting: [],
          opposing: ['Decision agent parsing error'],
        },
        executionGuidance: {
          useOriginalLevels: true,
          adjustedStopLoss: null,
          scaleInRecommended: false,
          monitorFor: [],
        },
        agentConsensus: 'split',
        tradeQualityGrade: 'C',
      };
    }
  }
}

export type { DecisionContext };
