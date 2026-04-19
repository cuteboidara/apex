// src/indices/engine/smc/orderBlockAMTIntegration.ts
// Align SMC order blocks with AMT Fair Value Area and compute combined score

import type { OrderBlock, FairValueGap } from '@/src/indices/types';
import type { FairValueArea, OrderFlowConfirmation } from '@/src/indices/types/amtTypes';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface OBAlignment {
  /** Does the order block overlap or sit adjacent to the FVA? */
  alignsWithFVA: boolean;
  /** 'inside' | 'at_boundary' | 'outside' */
  position: 'inside' | 'at_boundary' | 'outside';
  /** 0-10: how closely the OB aligns with FVA center/edge */
  alignmentScore: number;
  /** OB has been swept (liquidity taken) — required for AMT entry */
  swept: boolean;
  /** Combined SMC + AMT quality score (0–20) */
  combinedScore: number;
  reason: string[];
}

export interface AMTSMCIntegration {
  /** Best order block after AMT filtering */
  primaryOB: OrderBlock | null;
  /** Supporting FVG (optional) */
  supportingFVG: FairValueGap | null;
  /** How well SMC aligns with AMT (0–20 points) */
  smcTaAlignmentScore: number;
  /** Entry zone refined by both OB and FVA */
  refinedEntryZone: { high: number; low: number; mid: number } | null;
  /** Stop loss level below/above the structure */
  stopLoss: number | null;
  reasons: string[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Test whether an order block overlaps with or is adjacent to a FVA.
 * "At boundary" = OB mid is within 20% of bandWidth from FVA edge.
 */
function classifyOBvsFFVA(
  ob: OrderBlock,
  fva: FairValueArea,
): 'inside' | 'at_boundary' | 'outside' {
  const tolerance = fva.bandWidth * 0.2;

  const obHigh = ob.high;
  const obLow = ob.low;

  // Full overlap check
  const overlaps = obLow <= fva.upper + tolerance && obHigh >= fva.lower - tolerance;
  if (!overlaps) return 'outside';

  // Inside check: both edges within FVA
  const fullyInside = obHigh <= fva.upper + tolerance && obLow >= fva.lower - tolerance;
  if (fullyInside) return 'inside';

  return 'at_boundary';
}

function scoreOBAlignment(
  ob: OrderBlock,
  fva: FairValueArea,
  position: 'inside' | 'at_boundary' | 'outside',
  direction: 'bullish' | 'bearish',
): number {
  if (position === 'outside') return 0;

  let score = 0;

  // Base alignment
  if (position === 'inside') score += 5;
  else score += 3; // at_boundary

  // OB direction matches FVA context
  // For a long setup: bullish OB near FVA lower = best
  // For a short setup: bearish OB near FVA upper = best
  const fvaEdge = direction === 'bullish' ? fva.lower : fva.upper;
  const obMid = ob.mid;
  const distFromEdge = Math.abs(obMid - fvaEdge);
  const relDist = fva.bandWidth > 0 ? distFromEdge / fva.bandWidth : 1;

  if (relDist <= 0.3) score += 3;
  else if (relDist <= 0.6) score += 2;
  else score += 1;

  // OB quality bonus
  if (ob.quality >= 10) score += 2;
  else if (ob.quality >= 7) score += 1;

  return Math.min(10, score);
}

// ─── Main Integration ──────────────────────────────────────────────────────

/**
 * Integrate SMC order blocks with AMT Fair Value Area.
 * Returns the best-aligned OB and a combined SMC/TA alignment score.
 *
 * @param orderBlocks   Detected OBs (bullish for long, bearish for short)
 * @param fvgs          Detected FVGs
 * @param fva           Current Fair Value Area
 * @param orderFlow     Confirmed order flow result
 * @param direction     Signal direction
 * @param currentPrice  Current market price
 */
export function integrateOBWithAMT(
  orderBlocks: OrderBlock[],
  fvgs: FairValueGap[],
  fva: FairValueArea,
  orderFlow: OrderFlowConfirmation,
  direction: 'long' | 'short',
  currentPrice: number,
): AMTSMCIntegration {
  const obDirection = direction === 'long' ? 'bullish' : 'bearish';
  const reasons: string[] = [];

  // Filter OBs by direction
  const matchingOBs = orderBlocks.filter(ob => ob.type === obDirection);

  if (matchingOBs.length === 0) {
    reasons.push(`No ${obDirection} order blocks found`);
    return {
      primaryOB: null,
      supportingFVG: null,
      smcTaAlignmentScore: 0,
      refinedEntryZone: null,
      stopLoss: null,
      reasons,
    };
  }

  // Score each OB against AMT FVA
  const scored = matchingOBs.map(ob => {
    const position = classifyOBvsFFVA(ob, fva);
    const alignmentScore = scoreOBAlignment(ob, fva, position, obDirection);
    const swept = ob.liquiditySwept;

    const combinedScore = ob.quality + alignmentScore + (swept ? 3 : 0);

    const alignment: OBAlignment = {
      alignsWithFVA: position !== 'outside',
      position,
      alignmentScore,
      swept,
      combinedScore,
      reason: [],
    };

    if (position === 'outside') alignment.reason.push('OB outside FVA — weaker context');
    if (swept) alignment.reason.push('Liquidity swept — institutional interest confirmed');
    if (alignmentScore >= 7) alignment.reason.push('Strong FVA alignment');

    return { ob, alignment };
  });

  // Sort by combined score descending
  scored.sort((a, b) => b.alignment.combinedScore - a.alignment.combinedScore);

  // Prefer swept OBs that align with FVA
  const sweptAligned = scored.find(s => s.alignment.swept && s.alignment.alignsWithFVA);
  const best = sweptAligned ?? scored[0];

  const primaryOB = best.ob;
  const alignment = best.alignment;

  reasons.push(...alignment.reason);
  if (!alignment.alignsWithFVA) {
    reasons.push('Best OB does not align with FVA — reduced confidence');
  }

  // Find supporting FVG in same direction, near OB
  const fvgDirection = obDirection;
  const supportingFVG = fvgs
    .filter(fvg => fvg.type === fvgDirection)
    .find(fvg => {
      const fvgMid = (fvg.gapHigh + fvg.gapLow) / 2;
      return Math.abs(fvgMid - primaryOB.mid) < primaryOB.range * 3;
    }) ?? null;

  if (supportingFVG) {
    reasons.push('Supporting FVG found near order block');
  }

  // Refine entry zone: intersection of OB range and FVA when possible
  let refinedEntry: { high: number; low: number; mid: number } | null = null;

  if (alignment.alignsWithFVA) {
    // Intersection zone: overlap of OB and FVA
    const zoneHigh = Math.min(primaryOB.high, fva.upper);
    const zoneLow = Math.max(primaryOB.low, fva.lower);

    if (zoneHigh > zoneLow) {
      refinedEntry = {
        high: zoneHigh,
        low: zoneLow,
        mid: (zoneHigh + zoneLow) / 2,
      };
      reasons.push('Entry zone refined to OB ∩ FVA intersection');
    } else {
      // No overlap — use OB as primary
      refinedEntry = {
        high: primaryOB.high,
        low: primaryOB.low,
        mid: primaryOB.mid,
      };
    }
  } else {
    refinedEntry = {
      high: primaryOB.high,
      low: primaryOB.low,
      mid: primaryOB.mid,
    };
  }

  // Use order flow invalidation level as stop, or OB extreme
  let stopLoss: number;
  if (orderFlow.confirmed && orderFlow.invalidationLevel) {
    stopLoss = orderFlow.invalidationLevel;
  } else {
    // Default: beyond OB with small buffer (0.1%)
    const buffer = primaryOB.mid * 0.001;
    stopLoss = direction === 'long'
      ? primaryOB.low - buffer
      : primaryOB.high + buffer;
  }

  // Compute final SMC/TA alignment score (0–20)
  let smcTaScore = 0;

  // OB alignment with FVA: 0–8
  smcTaScore += alignment.alignmentScore * 0.8;

  // OB swept (liquidity taken): +4
  if (alignment.swept) smcTaScore += 4;

  // Order flow confirmed: +5
  if (orderFlow.confirmed) smcTaScore += 5;

  // Supporting FVG: +3
  if (supportingFVG) smcTaScore += 3;

  smcTaScore = Math.min(20, Math.round(smcTaScore));

  return {
    primaryOB,
    supportingFVG,
    smcTaAlignmentScore: smcTaScore,
    refinedEntryZone: refinedEntry,
    stopLoss,
    reasons,
  };
}
