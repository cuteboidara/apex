import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCachedJson, setCachedJson } from '@/src/lib/redis';
import type { MacroContext } from '@/src/indices/types';

import { AnalystAgent } from './agents/AnalystAgent';
import { DecisionAgent } from './agents/DecisionAgent';
import { MacroAgent } from './agents/MacroAgent';
import { RiskAgent } from './agents/RiskAgent';
import type {
  AnalystOutput,
  AgentRunResult,
  MacroOutput,
  RiskOutput,
  DecisionOutput,
  ReasoningAnalysisResult,
  ReasoningMarketData,
  ReasoningSignalInput,
  RecentSignalOutcome,
} from './types';

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const CACHE_KEY_PREFIX = 'amt:reasoning:signal:';
const DEFAULT_CONCURRENCY = 3;

function cacheKey(signalId: string): string {
  return `${CACHE_KEY_PREFIX}${signalId}`;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getTradeOutcome(trade: { status: string; profitLoss: number | null } | null): 'win' | 'loss' | 'pending' {
  if (!trade) return 'pending';
  if (trade.status !== 'closed') return 'pending';
  return (trade.profitLoss ?? 0) > 0 ? 'win' : 'loss';
}

function toDecisionOutput(value: unknown, fallbackScore: number): DecisionOutput {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<DecisionOutput>;
  const action = source.action === 'EXECUTE' || source.action === 'WATCH' || source.action === 'SKIP'
    ? source.action
    : 'WATCH';
  const scoreDelta = typeof source.scoreDelta === 'number' ? Math.max(-20, Math.min(20, Math.round(source.scoreDelta))) : 0;
  const finalScore = typeof source.finalScore === 'number'
    ? Math.max(0, Math.min(100, Math.round(source.finalScore)))
    : Math.max(0, Math.min(100, Math.round(fallbackScore + scoreDelta)));

  return {
    action,
    scoreDelta,
    finalScore,
    confidence: typeof source.confidence === 'number' ? Math.max(0, Math.min(100, Math.round(source.confidence))) : 50,
    primaryReasoning: typeof source.primaryReasoning === 'string' ? source.primaryReasoning : 'Decision output unavailable.',
    keyFactors: {
      supporting: Array.isArray(source.keyFactors?.supporting)
        ? source.keyFactors.supporting.filter((item): item is string => typeof item === 'string')
        : [],
      opposing: Array.isArray(source.keyFactors?.opposing)
        ? source.keyFactors.opposing.filter((item): item is string => typeof item === 'string')
        : [],
    },
    executionGuidance: {
      useOriginalLevels: typeof source.executionGuidance?.useOriginalLevels === 'boolean'
        ? source.executionGuidance.useOriginalLevels
        : true,
      adjustedStopLoss: typeof source.executionGuidance?.adjustedStopLoss === 'number'
        ? source.executionGuidance.adjustedStopLoss
        : null,
      scaleInRecommended: typeof source.executionGuidance?.scaleInRecommended === 'boolean'
        ? source.executionGuidance.scaleInRecommended
        : false,
      monitorFor: Array.isArray(source.executionGuidance?.monitorFor)
        ? source.executionGuidance.monitorFor.filter((item): item is string => typeof item === 'string')
        : [],
    },
    agentConsensus: source.agentConsensus === 'aligned' || source.agentConsensus === 'conflicted' || source.agentConsensus === 'split'
      ? source.agentConsensus
      : 'split',
    tradeQualityGrade: source.tradeQualityGrade === 'A+' || source.tradeQualityGrade === 'A'
      || source.tradeQualityGrade === 'B' || source.tradeQualityGrade === 'C'
      || source.tradeQualityGrade === 'D' || source.tradeQualityGrade === 'F'
      ? source.tradeQualityGrade
      : 'C',
  };
}

function buildFallbackAnalyst(signal: ReasoningSignalInput, reason: string): AnalystOutput {
  return {
    conviction: 0,
    summary: `Analyst unavailable: ${reason}`,
    strengths: [],
    weaknesses: ['LLM analyst unavailable'],
    keyLevels: {
      criticalSupport: signal.entryZone.low,
      criticalResistance: signal.entryZone.high,
      invalidationPrice: signal.stopLoss,
    },
  };
}

function buildFallbackRisk(reason: string): RiskOutput {
  return {
    riskScore: 5,
    warnings: [`Risk agent unavailable: ${reason}`],
    criticalConcerns: [],
    suggestedSlAdjustment: {
      shouldAdjust: false,
      newStopLoss: null,
      reason: 'Fallback mode',
    },
    shouldBlock: false,
    summary: 'Risk analysis unavailable. Treat signal as WATCH until LLM service recovers.',
  };
}

function buildFallbackMacro(reason: string): MacroOutput {
  return {
    alignmentScore: 0,
    supportingFactors: [],
    conflictingFactors: [`Macro agent unavailable: ${reason}`],
    newsRisk: {
      level: 'caution',
      blockingEvents: [],
    },
    regimeContext: 'Macro analysis unavailable',
    summary: 'Macro analysis unavailable. Use manual macro checks.',
  };
}

function buildFallbackDecision(signal: ReasoningSignalInput, reason: string): DecisionOutput {
  return {
    action: 'WATCH',
    scoreDelta: 0,
    finalScore: Math.round(signal.totalScore),
    confidence: 35,
    primaryReasoning: `Decision fallback: ${reason}`,
    keyFactors: {
      supporting: [],
      opposing: ['LLM decision unavailable'],
    },
    executionGuidance: {
      useOriginalLevels: true,
      adjustedStopLoss: null,
      scaleInRecommended: false,
      monitorFor: ['Restore Anthropic credits', 'Re-run cycle'],
    },
    agentConsensus: 'split',
    tradeQualityGrade: 'C',
  };
}

export class ReasoningOrchestrator {
  private readonly analyst = new AnalystAgent();
  private readonly risk = new RiskAgent();
  private readonly macro = new MacroAgent();
  private readonly decision = new DecisionAgent();

  private async buildRecentSignals(assetId: string, signalId: string): Promise<RecentSignalOutcome[]> {
    const rows = await prisma.indicesSignal.findMany({
      where: {
        assetId,
        id: { not: signalId },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        assetId: true,
        totalScore: true,
        createdAt: true,
        trades: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            status: true,
            profitLoss: true,
          },
        },
      },
    });

    return rows.map(row => ({
      id: row.id,
      assetId: row.assetId,
      totalScore: row.totalScore,
      outcome: getTradeOutcome(row.trades[0] ?? null),
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async getCachedOrStored(signal: ReasoningSignalInput): Promise<ReasoningAnalysisResult | null> {
    const cached = await getCachedJson<ReasoningAnalysisResult>(cacheKey(signal.id));
    if (cached) return cached;

    const stored = await prisma.signalReasoning.findUnique({
      where: { signalId: signal.id },
      select: {
        signalId: true,
        analystOutput: true,
        riskOutput: true,
        macroOutput: true,
        decisionOutput: true,
        totalLatencyMs: true,
        totalTokensUsed: true,
        totalCostUsd: true,
        signal: {
          select: {
            assetId: true,
            totalScore: true,
          },
        },
      },
    });

    if (!stored) return null;

    const restored: ReasoningAnalysisResult = {
      signalId: stored.signalId,
      assetId: stored.signal.assetId,
      signalScore: stored.signal.totalScore,
      analyst: (stored.analystOutput ?? {}) as unknown as ReasoningAnalysisResult['analyst'],
      risk: (stored.riskOutput ?? {}) as unknown as ReasoningAnalysisResult['risk'],
      macro: (stored.macroOutput ?? {}) as unknown as ReasoningAnalysisResult['macro'],
      decision: toDecisionOutput(stored.decisionOutput, stored.signal.totalScore),
      metrics: {
        latencyMs: stored.totalLatencyMs,
        tokensUsed: stored.totalTokensUsed,
        costUsd: stored.totalCostUsd,
      },
    };

    await setCachedJson(cacheKey(signal.id), restored, CACHE_TTL_SECONDS);
    return restored;
  }

  async analyzeSignal(
    signal: ReasoningSignalInput,
    marketData: ReasoningMarketData,
    macroContext: MacroContext,
  ): Promise<ReasoningAnalysisResult> {
    const existing = await this.getCachedOrStored(signal);
    if (existing) return existing;

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is required for LLM reasoning');
    }

    const startedAt = Date.now();
    const recentSignals = await this.buildRecentSignals(signal.assetId, signal.id);
    const baseContext = {
      signal,
      marketData,
      macroContext,
      recentSignals,
    };

    let analystResult: AgentRunResult<AnalystOutput>;
    let riskResult: AgentRunResult<RiskOutput>;
    let macroResult: AgentRunResult<MacroOutput>;
    let decisionResult: AgentRunResult<DecisionOutput>;

    try {
      [analystResult, riskResult, macroResult] = await Promise.all([
        this.analyst.run(baseContext),
        this.risk.run(baseContext),
        this.macro.run(baseContext),
      ]);

      decisionResult = await this.decision.run({
        ...baseContext,
        analystOutput: analystResult.output,
        riskOutput: riskResult.output,
        macroOutput: macroResult.output,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown reasoning failure';
      console.error(`[reasoning] Falling back for ${signal.assetId}:`, reason);

      analystResult = {
        agentName: 'AnalystFallback',
        output: buildFallbackAnalyst(signal, reason),
        reasoning: reason,
        latencyMs: 0,
        tokensUsed: 0,
        costUsd: 0,
      };
      riskResult = {
        agentName: 'RiskFallback',
        output: buildFallbackRisk(reason),
        reasoning: reason,
        latencyMs: 0,
        tokensUsed: 0,
        costUsd: 0,
      };
      macroResult = {
        agentName: 'MacroFallback',
        output: buildFallbackMacro(reason),
        reasoning: reason,
        latencyMs: 0,
        tokensUsed: 0,
        costUsd: 0,
      };
      decisionResult = {
        agentName: 'DecisionFallback',
        output: buildFallbackDecision(signal, reason),
        reasoning: reason,
        latencyMs: 0,
        tokensUsed: 0,
        costUsd: 0,
      };
    }

    const totalLatencyMs = Date.now() - startedAt;
    const totalTokensUsed = analystResult.tokensUsed + riskResult.tokensUsed + macroResult.tokensUsed + decisionResult.tokensUsed;
    const totalCostUsd = analystResult.costUsd + riskResult.costUsd + macroResult.costUsd + decisionResult.costUsd;

    await prisma.signalReasoning.upsert({
      where: { signalId: signal.id },
      create: {
        signalId: signal.id,
        analystOutput: toJsonValue(analystResult.output),
        riskOutput: toJsonValue(riskResult.output),
        macroOutput: toJsonValue(macroResult.output),
        decisionOutput: toJsonValue(decisionResult.output),
        totalLatencyMs,
        totalTokensUsed,
        totalCostUsd,
      },
      update: {
        analystOutput: toJsonValue(analystResult.output),
        riskOutput: toJsonValue(riskResult.output),
        macroOutput: toJsonValue(macroResult.output),
        decisionOutput: toJsonValue(decisionResult.output),
        totalLatencyMs,
        totalTokensUsed,
        totalCostUsd,
      },
    });

    await prisma.indicesSignal.update({
      where: { id: signal.id },
      data: {
        finalScore: decisionResult.output.finalScore,
        finalAction: decisionResult.output.action,
      },
    }).catch(updateError => {
      console.warn(`[reasoning] Could not update finalScore/finalAction for ${signal.id}:`, updateError);
    });

    const result: ReasoningAnalysisResult = {
      signalId: signal.id,
      assetId: signal.assetId,
      signalScore: signal.totalScore,
      analyst: analystResult.output,
      risk: riskResult.output,
      macro: macroResult.output,
      decision: decisionResult.output,
      metrics: {
        latencyMs: totalLatencyMs,
        tokensUsed: totalTokensUsed,
        costUsd: totalCostUsd,
      },
    };

    await setCachedJson(cacheKey(signal.id), result, CACHE_TTL_SECONDS);
    return result;
  }

  async batchAnalyze(
    signals: ReasoningSignalInput[],
    marketDataMap: Map<string, ReasoningMarketData>,
    macroContext: MacroContext,
  ): Promise<ReasoningAnalysisResult[]> {
    const queue = [...signals];
    const results: ReasoningAnalysisResult[] = [];
    const concurrency = Math.max(
      1,
      Number.isFinite(Number(process.env.LLM_REASONING_CONCURRENCY))
        ? Number(process.env.LLM_REASONING_CONCURRENCY)
        : DEFAULT_CONCURRENCY,
    );

    const workerCount = Math.min(concurrency, queue.length || 1);
    const workers = Array.from({ length: workerCount }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;

        const marketData = marketDataMap.get(next.assetId) ?? { recentCandles: [], currentPrice: null };
        try {
          const analyzed = await this.analyzeSignal(next, marketData, macroContext);
          results.push(analyzed);
        } catch (error) {
          console.error(`[reasoning] Failed for ${next.assetId}:`, error);
        }
      }
    });

    await Promise.all(workers);
    return results;
  }
}
