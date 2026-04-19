// src/indices/engine/ranking/signalRanker.ts
// Aggregate all layer scores, filter, rank, and produce final RankedSignal[]

import type {
  Candle,
  SMCSetup,
  TAConfluence,
  MacroScore,
  QuantAnalysis,
  RankedSignal,
  MacroContext,
  CorrelationPair,
} from '@/src/indices/types';
import type { AssetSymbol } from '@/src/indices/data/fetchers/assetConfig';
import { ASSET_CONFIG, ASSET_SYMBOLS } from '@/src/indices/data/fetchers/assetConfig';
import type { MultiTimeframeCandles } from '@/src/indices/data/fetchers/indicesFetcher';
import { runSMCAnalysis } from '../smc/smcScorer';
import { runTAAnalysis } from '../ta/taScorer';
import { scoreMacroContext, buildMacroSummary } from '../macro/macroScorer';
import { computeCorrelationMatrix } from '../quant/correlationMatrix';
import { runQuantAnalysis } from '../quant/quantScorer';
import { buildTradeManagementPlan } from '../tradeManagement/tradeBuilder';

const MIN_TOTAL_SCORE = 50;
const DEFAULT_ACCOUNT_SIZE = 5000;
const DEFAULT_RISK_PCT = 0.01; // 1%

export async function rankSignals(
  candlesByAsset: Map<AssetSymbol, MultiTimeframeCandles>,
  macroContext: MacroContext,
  options?: { accountSize?: number; riskPct?: number; minScore?: number },
): Promise<RankedSignal[]> {
  const accountSize = options?.accountSize ?? DEFAULT_ACCOUNT_SIZE;
  const riskPct = options?.riskPct ?? DEFAULT_RISK_PCT;
  const minScore = options?.minScore ?? MIN_TOTAL_SCORE;

  // Build daily candle map for correlation
  const dailyCandleMap = new Map<AssetSymbol, Candle[]>();
  for (const [symbol, mtf] of candlesByAsset) {
    if (mtf.daily.length > 0) dailyCandleMap.set(symbol, mtf.daily);
  }

  // Compute correlations once
  const correlationPairs = await computeCorrelationMatrix(dailyCandleMap);

  // ─── Phase 1: Run SMC + TA + Macro for each asset ─────────────────────
  type CandidateSignal = {
    assetId: AssetSymbol;
    direction: 'long' | 'short';
    smc: SMCSetup;
    ta: TAConfluence;
    macro: MacroScore;
    baseScore: number;
  };

  const candidates: CandidateSignal[] = [];

  for (const [assetId, mtf] of candlesByAsset) {
    if (mtf.daily.length < 30) continue;

    const smcSetup = runSMCAnalysis(assetId, mtf.daily);
    if (!smcSetup) continue;
    if (smcSetup.smcScore < 15) continue; // weak SMC setup, skip early

    const direction: 'long' | 'short' = smcSetup.direction === 'bullish' ? 'long' : 'short';

    if (macroContext) {
      const macro = scoreMacroContext(assetId, direction, macroContext);
      if (macro.eventRisk === 'blocked') continue; // hard block

      const entryPrice = smcSetup.entryZoneMid;
      const stopLoss = smcSetup.stopLossLevel;
      const stopDistance = Math.abs(entryPrice - stopLoss);
      const tp1 = direction === 'long' ? entryPrice + stopDistance : entryPrice - stopDistance;
      const tp2 = direction === 'long' ? entryPrice + stopDistance * 2 : entryPrice - stopDistance * 2;

      const ta = runTAAnalysis(
        assetId,
        mtf.daily,
        mtf.weekly,
        entryPrice,
        stopLoss,
        tp1,
        tp2,
        smcSetup.direction,
      );

      const baseScore = smcSetup.smcScore + ta.taScore + macro.macroScore;
      candidates.push({ assetId, direction, smc: smcSetup, ta, macro, baseScore });
    }
  }

  if (candidates.length === 0) return [];

  // ─── Phase 2: Build signal directions map for correlation bonus ────────
  const signalDirections = new Map<string, 'long' | 'short'>(
    candidates.map(c => [c.assetId, c.direction]),
  );

  // SPX candles for beta calculation (market proxy)
  const spxCandles = candlesByAsset.get('SPX500')?.daily ?? [];

  // ─── Phase 3: Quant analysis + final scoring ──────────────────────────
  const scored = candidates.map(c => {
    const riskAmount = accountSize * riskPct;
    const tradePlan = buildTradeManagementPlan(c.assetId, c.smc, c.direction, riskAmount);

    const quant = runQuantAnalysis({
      assetId: c.assetId,
      direction: c.direction,
      entry: c.smc.entryZoneMid,
      stopLoss: c.smc.stopLossLevel,
      tp1: tradePlan.takeProfits.tp1.level,
      tp2: tradePlan.takeProfits.tp2.level,
      assetCandles: candlesByAsset.get(c.assetId)?.daily ?? [],
      spxCandles,
      correlationPairs,
      signalDirections,
      accountSize,
      riskPct,
    });

    const total = Math.min(100, c.baseScore + quant.correlationBonus);

    return {
      assetId: c.assetId,
      direction: c.direction,
      smc: c.smc,
      ta: c.ta,
      macro: c.macro,
      quant,
      tradePlan,
      total,
      scores: {
        smc: c.smc.smcScore,
        ta: c.ta.taScore,
        macro: c.macro.macroScore,
        quantBonus: quant.correlationBonus,
        total,
      },
    };
  });

  // ─── Phase 4: Filter + sort ───────────────────────────────────────────
  const filtered = scored.filter(s => s.total >= minScore);
  filtered.sort((a, b) => b.total - a.total);

  // ─── Phase 5: Build final RankedSignal objects ─────────────────────────
  return filtered.map((s, idx): RankedSignal => {
    const config = ASSET_CONFIG[s.assetId];
    const correlations = correlationPairs
      .filter(p => p.asset1 === s.assetId || p.asset2 === s.assetId)
      .map(p => ({
        asset: p.asset1 === s.assetId ? p.asset2 : p.asset1,
        correlation: p.correlation,
        isAlsoSignaling: signalDirections.has(p.asset1 === s.assetId ? p.asset2 : p.asset1),
      }));

    const winRate = estimateHistoricalWinRate(s.scores.total);

    return {
      rank: idx + 1,
      assetId: s.assetId,
      scanTimestamp: new Date(),
      direction: s.direction,
      scores: s.scores,
      smcSetup: s.smc,
      taConfluence: s.ta,
      macroScore: s.macro,
      quantAnalysis: s.quant,
      tradeManagement: s.tradePlan,
      positionSize: s.quant.suggestedPositionSize,
      riskAmount: s.quant.suggestedRiskAmount,
      reasoning: buildReasoning(s.smc, s.ta, s.macro, s.quant, s.direction),
      correlations,
      historicalWinRate: winRate,
      historicalAvgRR: 2.1,
      totalBacktestedTrades: 0, // filled from DB in production
      macroSummary: buildMacroSummary(s.macro),
      newsRisk: s.macro.eventRisk,
    };
  });
}

function estimateHistoricalWinRate(score: number): number {
  // Score-based win rate estimate (will be replaced by real DB stats)
  if (score >= 85) return 0.68;
  if (score >= 75) return 0.62;
  if (score >= 65) return 0.57;
  return 0.52;
}

function buildReasoning(
  smc: SMCSetup,
  ta: TAConfluence,
  macro: MacroScore,
  quant: QuantAnalysis,
  direction: 'long' | 'short',
): string {
  const parts: string[] = [];

  parts.push(`SMC: ${smc.reasoning[0] ?? 'Order block setup'}`);
  parts.push(`HTF bias ${ta.htfBias.combined.replace(/_/g, ' ')} (${ta.biasPoints}/10 pts)`);
  parts.push(`RSI ${ta.rsi.value.toFixed(1)} — ${ta.rsi.state}`);
  parts.push(`Macro: DXY ${macro.dxyStrength}, VIX ${macro.vixRegime}, yields ${macro.yieldTrend}`);

  if (quant.correlatedAssets.length > 0) {
    parts.push(`Correlated confirmation: ${quant.correlatedAssets.join(', ')}`);
  }
  if (quant.sharpeInterpretation === 'excellent' || quant.sharpeInterpretation === 'good') {
    parts.push(`Sharpe ratio ${quant.sharpeRatio.toFixed(2)} (${quant.sharpeInterpretation})`);
  }

  return parts.join('. ');
}
