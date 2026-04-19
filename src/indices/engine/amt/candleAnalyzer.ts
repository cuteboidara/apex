// src/indices/engine/amt/candleAnalyzer.ts
// Candle quality scoring and sequential pattern detection for AMT

import type { Candle } from '@/src/indices/types';
import type {
  CandleAnalysis,
  CandleDirection,
  AggressionLevel,
  SequentialPattern,
  SequentialPatternType,
  PatternStrength,
} from '@/src/indices/types/amtTypes';

// ─── Single Candle Analysis ────────────────────────────────────────────────

/**
 * Classify candle direction based on close vs open.
 * Indecision = body < 30% of total range.
 */
function classifyDirection(candle: Candle): CandleDirection {
  const range = candle.high - candle.low;
  if (range === 0) return 'indecision';

  const body = Math.abs(candle.close - candle.open);
  const bodyRatio = body / range;

  if (bodyRatio < 0.3) return 'indecision';
  return candle.close >= candle.open ? 'bullish' : 'bearish';
}

/**
 * Body strength = body size / total range (0–1).
 */
function computeBodyStrength(candle: Candle): number {
  const range = candle.high - candle.low;
  if (range === 0) return 0;
  return Math.abs(candle.close - candle.open) / range;
}

/**
 * Upper wick = high to max(open,close).
 * Lower wick = min(open,close) to low.
 * Rejection = wick > 40% of total range.
 */
function detectRejection(candle: Candle): { upper: boolean; lower: boolean } {
  const range = candle.high - candle.low;
  if (range === 0) return { upper: false, lower: false };

  const bodyTop = Math.max(candle.open, candle.close);
  const bodyBottom = Math.min(candle.open, candle.close);

  const upperWick = candle.high - bodyTop;
  const lowerWick = bodyBottom - candle.low;
  const threshold = range * 0.4;

  return {
    upper: upperWick >= threshold,
    lower: lowerWick >= threshold,
  };
}

/**
 * Aggressiveness based on body strength and direction clarity:
 * - high:   body strength ≥ 0.65 and no opposite wick
 * - medium: body strength ≥ 0.40
 * - low:    body strength < 0.40
 */
function classifyAggressiveness(
  bodyStrength: number,
  rejection: { upper: boolean; lower: boolean },
  direction: CandleDirection,
): AggressionLevel {
  if (direction === 'indecision') return 'low';

  const oppositeRejection =
    direction === 'bullish' ? rejection.upper : rejection.lower;

  if (bodyStrength >= 0.65 && !oppositeRejection) return 'high';
  if (bodyStrength >= 0.40) return 'medium';
  return 'low';
}

/**
 * Score a single candle 0–10:
 * - Body strength contribution: 0–5
 * - Direction clarity: 0–2
 * - No opposite wick: 0–2
 * - Close near high (bull) / low (bear): 0–1
 */
function scoreCandle(
  bodyStrength: number,
  direction: CandleDirection,
  rejection: { upper: boolean; lower: boolean },
  candle: Candle,
): { score: number; reason: string } {
  if (direction === 'indecision') {
    return { score: 1, reason: 'Indecision candle — no directional conviction' };
  }

  let score = 0;
  const reasons: string[] = [];

  // Body strength: up to 5 pts
  const bodyPts = Math.round(bodyStrength * 5);
  score += bodyPts;
  if (bodyPts >= 4) reasons.push('strong body');

  // Direction clarity (not indecision): 2 pts
  score += 2;

  // No opposite-direction wick: 2 pts
  const oppositeRejection = direction === 'bullish' ? rejection.upper : rejection.lower;
  if (!oppositeRejection) {
    score += 2;
    reasons.push('clean close');
  } else {
    reasons.push('opposing wick present');
  }

  // Close near extreme: 1 pt
  const range = candle.high - candle.low;
  if (range > 0) {
    const closePos = (candle.close - candle.low) / range; // 0=low, 1=high
    if (direction === 'bullish' && closePos >= 0.8) {
      score += 1;
      reasons.push('close near high');
    } else if (direction === 'bearish' && closePos <= 0.2) {
      score += 1;
      reasons.push('close near low');
    }
  }

  return {
    score: Math.min(10, score),
    reason: reasons.join(', ') || `${direction} candle`,
  };
}

/**
 * Analyze a single candle and return a full CandleAnalysis.
 */
export function analyzeCandle(candle: Candle, index: number): CandleAnalysis {
  const direction = classifyDirection(candle);
  const bodyStrength = computeBodyStrength(candle);
  const rejection = detectRejection(candle);
  const aggressiveness = classifyAggressiveness(bodyStrength, rejection, direction);
  const { score, reason } = scoreCandle(bodyStrength, direction, rejection, candle);

  return {
    candleIndex: index,
    quality: score,
    direction,
    bodyStrength,
    rejection,
    aggressiveness,
    reason,
  };
}

/**
 * Analyze the last N candles (default 10) and return CandleAnalysis[].
 */
export function analyzeCandles(candles: Candle[], lookback = 10): CandleAnalysis[] {
  const slice = candles.slice(-lookback);
  return slice.map((c, i) => analyzeCandle(c, candles.length - lookback + i));
}

// ─── Sequential Pattern Detection ─────────────────────────────────────────

/**
 * Detect sequential patterns in a window of CandleAnalysis objects.
 */
export function detectSequentialPatterns(
  analyses: CandleAnalysis[],
): SequentialPattern[] {
  const patterns: SequentialPattern[] = [];

  if (analyses.length < 2) return patterns;

  // ── Strength Continuation ────────────────────────────────────────────
  // 2+ consecutive high-aggression candles in same direction
  for (let i = 0; i < analyses.length - 1; i++) {
    const run: number[] = [i];
    const dir = analyses[i].direction;

    if (dir === 'indecision') continue;
    if (analyses[i].aggressiveness !== 'high') continue;

    for (let j = i + 1; j < analyses.length; j++) {
      if (
        analyses[j].direction === dir &&
        analyses[j].aggressiveness !== 'low'
      ) {
        run.push(j);
      } else {
        break;
      }
    }

    if (run.length >= 2) {
      const allHigh = run.every(idx => analyses[idx].aggressiveness === 'high');
      const strength: PatternStrength = allHigh && run.length >= 3 ? 'very_high' : 'high';

      patterns.push({
        type: 'strength_continuation',
        strength,
        candleRange: [run[0], run[run.length - 1]],
        description: `${run.length} consecutive ${dir} aggression candles`,
        probability: allHigh ? 0.72 : 0.60,
      });
    }
  }

  // ── Rejection After Aggression ────────────────────────────────────────
  // High-aggression candle followed by 1–2 indecision/opposite candles
  for (let i = 0; i < analyses.length - 1; i++) {
    const a = analyses[i];
    if (a.aggressiveness !== 'high') continue;

    const next = analyses[i + 1];
    if (
      next.direction === 'indecision' ||
      (a.direction !== 'indecision' && next.direction !== a.direction)
    ) {
      patterns.push({
        type: 'rejection_after_aggression',
        strength: 'medium',
        candleRange: [i, i + 1],
        description: `${a.direction} aggression followed by ${next.direction}`,
        probability: 0.55,
      });
    }
  }

  // ── Failed Auction Long ───────────────────────────────────────────────
  // Bearish push → indecision/doji → bullish recovery
  for (let i = 0; i < analyses.length - 2; i++) {
    const a = analyses[i];
    const b = analyses[i + 1];
    const c = analyses[i + 2];

    if (
      a.direction === 'bearish' &&
      a.aggressiveness !== 'low' &&
      (b.direction === 'indecision' || b.quality <= 3) &&
      c.direction === 'bullish' &&
      c.aggressiveness !== 'low'
    ) {
      const strength: PatternStrength =
        a.aggressiveness === 'high' && c.aggressiveness === 'high'
          ? 'high'
          : 'medium';

      patterns.push({
        type: 'failed_auction_long',
        strength,
        candleRange: [i, i + 2],
        description: 'Bearish attempt absorbed — bullish recovery',
        probability: strength === 'high' ? 0.67 : 0.55,
      });
    }
  }

  // ── Failed Auction Short ──────────────────────────────────────────────
  // Bullish push → indecision → bearish drop
  for (let i = 0; i < analyses.length - 2; i++) {
    const a = analyses[i];
    const b = analyses[i + 1];
    const c = analyses[i + 2];

    if (
      a.direction === 'bullish' &&
      a.aggressiveness !== 'low' &&
      (b.direction === 'indecision' || b.quality <= 3) &&
      c.direction === 'bearish' &&
      c.aggressiveness !== 'low'
    ) {
      const strength: PatternStrength =
        a.aggressiveness === 'high' && c.aggressiveness === 'high'
          ? 'high'
          : 'medium';

      patterns.push({
        type: 'failed_auction_short',
        strength,
        candleRange: [i, i + 2],
        description: 'Bullish attempt absorbed — bearish reversal',
        probability: strength === 'high' ? 0.67 : 0.55,
      });
    }
  }

  // ── Breakout Acceptance ───────────────────────────────────────────────
  // 2+ consecutive candles closing beyond a prior consolidation range
  // (simplified: 3+ consecutive same-direction high-quality candles with no reversal)
  const breakoutRun = findBreakoutRun(analyses);
  if (breakoutRun) {
    patterns.push(breakoutRun);
  }

  // ── Absorption ────────────────────────────────────────────────────────
  // Large-range candle with close near open (wick both sides) — absorption of selling
  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    if (
      a.bodyStrength < 0.25 &&
      a.rejection.upper &&
      a.rejection.lower &&
      a.quality >= 4
    ) {
      patterns.push({
        type: 'absorption',
        strength: 'medium',
        candleRange: [i, i],
        description: 'Absorption candle — both sides rejected, tight close',
        probability: 0.50,
      });
    }
  }

  return deduplicatePatterns(patterns);
}

function findBreakoutRun(analyses: CandleAnalysis[]): SequentialPattern | null {
  if (analyses.length < 3) return null;

  // Find longest run of 3+ high/medium quality candles in same direction
  let best: { dir: CandleDirection; start: number; end: number } | null = null;

  for (let i = 0; i < analyses.length; i++) {
    const dir = analyses[i].direction;
    if (dir === 'indecision') continue;
    if (analyses[i].quality < 5) continue;

    let end = i;
    for (let j = i + 1; j < analyses.length; j++) {
      if (analyses[j].direction === dir && analyses[j].quality >= 4) {
        end = j;
      } else {
        break;
      }
    }

    const runLen = end - i + 1;
    if (runLen >= 3) {
      if (!best || runLen > best.end - best.start + 1) {
        best = { dir, start: i, end };
      }
    }
  }

  if (!best) return null;

  const runLen = best.end - best.start + 1;
  const strength: PatternStrength = runLen >= 4 ? 'very_high' : 'high';

  return {
    type: 'breakout_acceptance',
    strength,
    candleRange: [best.start, best.end],
    description: `${runLen} candles accepting ${best.dir} breakout`,
    probability: runLen >= 4 ? 0.72 : 0.62,
  };
}

/** Remove overlapping patterns, keeping the highest-strength one. */
function deduplicatePatterns(patterns: SequentialPattern[]): SequentialPattern[] {
  const strengthOrder: Record<PatternStrength, number> = {
    very_high: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  const result: SequentialPattern[] = [];

  for (const p of patterns) {
    const overlaps = result.findIndex(r =>
      p.candleRange[0] <= r.candleRange[1] &&
      p.candleRange[1] >= r.candleRange[0],
    );

    if (overlaps === -1) {
      result.push(p);
    } else {
      if (strengthOrder[p.strength] > strengthOrder[result[overlaps].strength]) {
        result[overlaps] = p;
      }
    }
  }

  return result;
}

/**
 * Compute a composite candle quality score for the last N candles (0–25).
 * Used in AMT signal scoring.
 *
 * Factors:
 * - Average quality of last 3 candles (0–10 each → normalized to 0–15)
 * - Pattern bonus: +5 if a high/very_high pattern is present, +3 medium
 * - Aggression bonus: +5 if latest candle is high aggression
 */
export function computeCandleQualityScore(
  analyses: CandleAnalysis[],
  patterns: SequentialPattern[],
): number {
  if (analyses.length === 0) return 0;

  const last3 = analyses.slice(-3);
  const avgQuality = last3.reduce((s, a) => s + a.quality, 0) / last3.length;

  // Normalize avg quality (0–10) to 0–15
  let score = Math.round((avgQuality / 10) * 15);

  // Pattern bonus
  const hasVeryHigh = patterns.some(p => p.strength === 'very_high');
  const hasHigh = patterns.some(p => p.strength === 'high');
  const hasMedium = patterns.some(p => p.strength === 'medium');

  if (hasVeryHigh) score += 5;
  else if (hasHigh) score += 4;
  else if (hasMedium) score += 3;

  // Latest candle aggression bonus
  const latest = analyses[analyses.length - 1];
  if (latest.aggressiveness === 'high') score += 5;
  else if (latest.aggressiveness === 'medium') score += 2;

  return Math.min(25, score);
}
