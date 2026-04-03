import { atr, formatPrice } from "@/src/assets/shared/strategyUtils";
import type { Candle } from "@/src/assets/shared/types";

export const MTF_TIMEFRAMES = ["1mo", "1wk", "1d", "4h", "1h", "30m", "15m", "5m"] as const;
export type MTFTimeframe = typeof MTF_TIMEFRAMES[number];

export interface MTFCandles {
  monthly: Candle[];
  weekly: Candle[];
  daily: Candle[];
  h4: Candle[];
  h1: Candle[];
  m15: Candle[];
  m5: Candle[];
}

export type Bias = "bullish" | "bearish" | "ranging";

export interface StructureBreak {
  type: "BOS" | "CHoCH";
  direction: "bullish" | "bearish";
  price: number;
  index: number;
}

export interface OrderBlock {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  mid: number;
  index: number;
  strength: number;
}

export interface FairValueGap {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  mid: number;
  filled: boolean;
  index: number;
}

export interface BreakerBlock {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  index: number;
}

export interface LiquiditySweep {
  type: "buy_side" | "sell_side";
  level: number;
  index: number;
  reversed: boolean;
}

export interface SDZone {
  type: "supply" | "demand";
  high: number;
  low: number;
  strength: number;
  tested: number;
}

type StructureState = {
  bias: Bias;
  pattern: "HH/HL" | "LH/LL" | "mixed";
  recentHigh: number | null;
  previousHigh: number | null;
  recentLow: number | null;
  previousLow: number | null;
  rangePct: number | null;
};

type PriceZoneCandidate = {
  kind: "order_block" | "fvg" | "sd_zone" | "breaker" | "liquidity" | "swing";
  timeframe: "1d" | "4h" | "1h" | "30m";
  direction: "bullish" | "bearish";
  low: number;
  high: number;
  weight: number;
  label: string;
};

type SweepCandidate = {
  entryTimeframe: "5m" | "15m";
  entry: number;
  stopLoss: number;
  sweepLevel: number;
  sweepExtreme: number;
  sweepIndex: number;
  confirmationIndex: number;
  confirmationLabel: "rejection" | "engulfing" | "mss";
  sweepDescription: string;
};

type ConfluenceScoreBreakdown = {
  htfAlignment: number;
  liquiditySweepPresence: number;
  ltfConfirmation: number;
  tightStopPlacement: number;
  rrQuality: number;
};

type ZoneRange = {
  low: number;
  high: number;
  label: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function aggregateCandles(candles: Candle[], bucketMs: number): Candle[] {
  if (candles.length === 0) {
    return [];
  }

  const grouped = new Map<number, Candle[]>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.time / bucketMs) * bucketMs;
    if (!grouped.has(bucket)) {
      grouped.set(bucket, []);
    }
    grouped.get(bucket)?.push(candle);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([bucket, group]) => ({
      time: bucket,
      open: group[0]?.open ?? group[0]?.close ?? 0,
      high: Math.max(...group.map(candle => candle.high)),
      low: Math.min(...group.map(candle => candle.low)),
      close: group.at(-1)?.close ?? group[0]?.close ?? 0,
      volume: group.reduce((sum, candle) => sum + (candle.volume ?? 0), 0),
    }))
    .filter(candle =>
      Number.isFinite(candle.open)
      && Number.isFinite(candle.high)
      && Number.isFinite(candle.low)
      && Number.isFinite(candle.close)
      && candle.open > 0
      && candle.high > 0
      && candle.low > 0
      && candle.close > 0,
    );
}

function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
    .join(" ");
}

function calculateRiskReward(entry: number, stopLoss: number, target: number): number {
  const risk = Math.abs(entry - stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) {
    return 0;
  }

  return Math.abs(target - entry) / risk;
}

function gradeFromConfluenceScore(score: number): string {
  if (score >= 88) return "S";
  if (score >= 76) return "A";
  if (score >= 64) return "B";
  if (score >= 52) return "C";
  if (score >= 40) return "D";
  return "F";
}

function pipBuffer(symbol: string, price: number): number {
  const normalized = symbol.toUpperCase();
  if (normalized.includes("JPY")) {
    return 0.04;
  }
  if (/[A-Z]{6}$/.test(normalized) || normalized.endsWith("USD")) {
    if (price >= 100 && normalized.includes("USD")) {
      return 0.2;
    }
    return 0.0004;
  }
  if (price >= 1000) {
    return 3;
  }
  if (price >= 100) {
    return 0.6;
  }
  if (price >= 10) {
    return 0.15;
  }
  if (price >= 1) {
    return price * 0.0025;
  }
  return price * 0.01;
}

function range(candle: Candle): number {
  return Math.max(candle.high - candle.low, 0.0000001);
}

function body(candle: Candle): number {
  return Math.abs(candle.close - candle.open);
}

function upperWick(candle: Candle): number {
  return candle.high - Math.max(candle.open, candle.close);
}

function lowerWick(candle: Candle): number {
  return Math.min(candle.open, candle.close) - candle.low;
}

function candleClosesInUpperRange(candle: Candle): boolean {
  const candleRange = range(candle);
  return candleRange > 0 && ((candle.close - candle.low) / candleRange) >= 0.6;
}

function candleClosesInLowerRange(candle: Candle): boolean {
  const candleRange = range(candle);
  return candleRange > 0 && ((candle.high - candle.close) / candleRange) >= 0.6;
}

function isBullishRejection(candle: Candle): boolean {
  return candle.close > candle.open
    && lowerWick(candle) >= body(candle) * 1.2
    && candleClosesInUpperRange(candle);
}

function isBearishRejection(candle: Candle): boolean {
  return candle.close < candle.open
    && upperWick(candle) >= body(candle) * 1.2
    && candleClosesInLowerRange(candle);
}

function isBullishEngulfing(previous: Candle, current: Candle): boolean {
  return previous.close < previous.open
    && current.close > current.open
    && current.close >= previous.open
    && current.open <= previous.close;
}

function isBearishEngulfing(previous: Candle, current: Candle): boolean {
  return previous.close > previous.open
    && current.close < current.open
    && current.close <= previous.open
    && current.open >= previous.close;
}

function extractSwingHighs(candles: Candle[], lookback = 2): Array<{ price: number; index: number }> {
  const points: Array<{ price: number; index: number }> = [];
  if (candles.length < (lookback * 2) + 1) {
    return points;
  }

  for (let index = lookback; index < candles.length - lookback; index += 1) {
    const current = candles[index];
    const left = candles.slice(index - lookback, index);
    const right = candles.slice(index + 1, index + lookback + 1);
    if (left.every(candle => candle.high < current.high) && right.every(candle => candle.high < current.high)) {
      points.push({ price: current.high, index });
    }
  }

  return points;
}

function extractSwingLows(candles: Candle[], lookback = 2): Array<{ price: number; index: number }> {
  const points: Array<{ price: number; index: number }> = [];
  if (candles.length < (lookback * 2) + 1) {
    return points;
  }

  for (let index = lookback; index < candles.length - lookback; index += 1) {
    const current = candles[index];
    const left = candles.slice(index - lookback, index);
    const right = candles.slice(index + 1, index + lookback + 1);
    if (left.every(candle => candle.low > current.low) && right.every(candle => candle.low > current.low)) {
      points.push({ price: current.low, index });
    }
  }

  return points;
}

function describeStructure(pattern: StructureState["pattern"], bias: Bias): string {
  if (pattern !== "mixed") {
    return pattern;
  }
  return bias === "bullish" ? "developing HH/HL" : bias === "bearish" ? "developing LH/LL" : "mixed structure";
}

function analyzeStructure(candles: Candle[]): StructureState {
  const swingHighs = extractSwingHighs(candles, 2);
  const swingLows = extractSwingLows(candles, 2);
  const recentHigh = swingHighs.at(-1)?.price ?? null;
  const previousHigh = swingHighs.at(-2)?.price ?? null;
  const recentLow = swingLows.at(-1)?.price ?? null;
  const previousLow = swingLows.at(-2)?.price ?? null;
  const baseBias = detectBias(candles, 18);
  const slice = candles.slice(-40);
  const rangeHigh = slice.length > 0 ? Math.max(...slice.map(candle => candle.high)) : null;
  const rangeLow = slice.length > 0 ? Math.min(...slice.map(candle => candle.low)) : null;
  const livePrice = candles.at(-1)?.close ?? null;
  const rangePct = rangeHigh != null && rangeLow != null && livePrice != null && rangeHigh > rangeLow
    ? ((livePrice - rangeLow) / (rangeHigh - rangeLow)) * 100
    : null;

  let pattern: StructureState["pattern"] = "mixed";
  let bias: Bias = baseBias;

  if (recentHigh != null && previousHigh != null && recentLow != null && previousLow != null) {
    if (recentHigh > previousHigh && recentLow > previousLow) {
      pattern = "HH/HL";
      bias = "bullish";
    } else if (recentHigh < previousHigh && recentLow < previousLow) {
      pattern = "LH/LL";
      bias = "bearish";
    }
  }

  return {
    bias,
    pattern,
    recentHigh,
    previousHigh,
    recentLow,
    previousLow,
    rangePct,
  };
}

export function detectBias(candles: Candle[], lookback = 20): Bias {
  if (candles.length < 5) {
    return "ranging";
  }

  const slice = candles.slice(-lookback);
  const comparisons = Math.max(slice.length - 1, 1);
  let hhCount = 0;
  let hlCount = 0;
  let lhCount = 0;
  let llCount = 0;

  for (let index = 1; index < slice.length; index += 1) {
    if (slice[index].high > slice[index - 1].high) hhCount += 1;
    if (slice[index].low > slice[index - 1].low) hlCount += 1;
    if (slice[index].high < slice[index - 1].high) lhCount += 1;
    if (slice[index].low < slice[index - 1].low) llCount += 1;
  }

  const denominator = comparisons * 2;
  const bullScore = (hhCount + hlCount) / denominator;
  const bearScore = (lhCount + llCount) / denominator;

  if (bullScore > 0.55) return "bullish";
  if (bearScore > 0.55) return "bearish";
  return "ranging";
}

export function detectStructureBreaks(candles: Candle[]): StructureBreak[] {
  const breaks: StructureBreak[] = [];
  if (candles.length < 10) {
    return breaks;
  }

  for (let index = 3; index < candles.length; index += 1) {
    const previous = candles.slice(index - 3, index);
    const previousHigh = Math.max(...previous.map(candle => candle.high));
    const previousLow = Math.min(...previous.map(candle => candle.low));
    const current = candles[index];

    if (current.close > previousHigh) {
      breaks.push({ type: "BOS", direction: "bullish", price: previousHigh, index });
    }
    if (current.close < previousLow) {
      breaks.push({ type: "BOS", direction: "bearish", price: previousLow, index });
    }
  }

  if (breaks.length >= 2) {
    const last = breaks[breaks.length - 1];
    const prior = breaks[breaks.length - 2];
    if (last.direction !== prior.direction) {
      breaks[breaks.length - 1] = {
        ...last,
        type: "CHoCH",
      };
    }
  }

  return breaks.slice(-6);
}

export function detectOrderBlocks(candles: Candle[]): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  if (candles.length < 5) {
    return blocks;
  }

  for (let index = 1; index < candles.length - 2; index += 1) {
    const candle = candles[index];
    const next = candles[index + 1];
    const next2 = candles[index + 2];
    const candleBody = body(candle);
    const candleRange = range(candle);

    if (candle.close < candle.open && next.close > next.open && next2.close > candle.high) {
      blocks.push({
        type: "bullish",
        high: candle.high,
        low: candle.low,
        mid: (candle.high + candle.low) / 2,
        index,
        strength: clamp((candleBody / candleRange) * 100 + 20, 20, 100),
      });
    }

    if (candle.close > candle.open && next.close < next.open && next2.close < candle.low) {
      blocks.push({
        type: "bearish",
        high: candle.high,
        low: candle.low,
        mid: (candle.high + candle.low) / 2,
        index,
        strength: clamp((candleBody / candleRange) * 100 + 20, 20, 100),
      });
    }
  }

  return blocks.slice(-8);
}

export function detectFVGs(candles: Candle[]): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  if (candles.length < 3) {
    return gaps;
  }

  for (let index = 1; index < candles.length - 1; index += 1) {
    const previous = candles[index - 1];
    const next = candles[index + 1];

    if (next.low > previous.high) {
      const filled = candles.slice(index + 2).some(candle => candle.low <= previous.high);
      gaps.push({
        type: "bullish",
        high: next.low,
        low: previous.high,
        mid: (next.low + previous.high) / 2,
        filled,
        index,
      });
    }

    if (next.high < previous.low) {
      const filled = candles.slice(index + 2).some(candle => candle.high >= previous.low);
      gaps.push({
        type: "bearish",
        high: previous.low,
        low: next.high,
        mid: (previous.low + next.high) / 2,
        filled,
        index,
      });
    }
  }

  return gaps.filter(gap => !gap.filled).slice(-8);
}

export function detectBreakerBlocks(candles: Candle[], blocks: OrderBlock[]): BreakerBlock[] {
  const breakers: BreakerBlock[] = [];

  for (const block of blocks) {
    const laterCandles = candles.slice(block.index + 1);
    if (block.type === "bullish") {
      const swept = laterCandles.some(candle => candle.low < block.low);
      if (swept) {
        breakers.push({
          type: "bearish",
          high: block.high,
          low: block.low,
          index: block.index,
        });
      }
      continue;
    }

    const swept = laterCandles.some(candle => candle.high > block.high);
    if (swept) {
      breakers.push({
        type: "bullish",
        high: block.high,
        low: block.low,
        index: block.index,
      });
    }
  }

  return breakers.slice(-6);
}

export function detectLiquiditySweeps(candles: Candle[]): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  if (candles.length < 10) {
    return sweeps;
  }

  for (let index = 5; index < candles.length - 1; index += 1) {
    const previous = candles.slice(index - 5, index);
    const previousHigh = Math.max(...previous.map(candle => candle.high));
    const previousLow = Math.min(...previous.map(candle => candle.low));
    const current = candles[index];
    const next = candles[index + 1];

    if (current.high > previousHigh && current.close < previousHigh) {
      sweeps.push({
        type: "buy_side",
        level: previousHigh,
        index,
        reversed: Boolean(next && next.close < current.close),
      });
    }

    if (current.low < previousLow && current.close > previousLow) {
      sweeps.push({
        type: "sell_side",
        level: previousLow,
        index,
        reversed: Boolean(next && next.close > current.close),
      });
    }
  }

  return sweeps.slice(-6);
}

export function detectSDZones(candles: Candle[]): SDZone[] {
  const zones: SDZone[] = [];
  if (candles.length < 20) {
    return zones;
  }

  for (let index = 2; index < candles.length - 2; index += 1) {
    const candle = candles[index];
    const previous = candles[index - 1];
    const candleRange = range(candle);
    const candleBody = body(candle);

    if (candle.close > candle.open && candleBody > candleRange * 0.6 && previous.close < previous.open) {
      const high = Math.max(previous.high, candle.open);
      const low = Math.min(previous.low, candle.open);
      const tested = candles.slice(index + 1).filter(next =>
        next.low <= high && next.high >= low,
      ).length;
      if (tested < 4) {
        zones.push({
          type: "demand",
          high,
          low,
          strength: Math.min(100, 70 + ((3 - tested) * 10)),
          tested,
        });
      }
    }

    if (candle.close < candle.open && candleBody > candleRange * 0.6 && previous.close > previous.open) {
      const high = Math.max(previous.high, candle.open);
      const low = Math.min(previous.low, candle.open);
      const tested = candles.slice(index + 1).filter(next =>
        next.low <= high && next.high >= low,
      ).length;
      if (tested < 4) {
        zones.push({
          type: "supply",
          high,
          low,
          strength: Math.min(100, 70 + ((3 - tested) * 10)),
          tested,
        });
      }
    }
  }

  return zones.slice(-8);
}

export function getPremiumDiscount(candles: Candle[], lookback = 50): {
  equilibrium: number;
  rangeHigh: number;
  rangeLow: number;
  zone: "premium" | "discount" | "equilibrium";
  pct: number;
} {
  const slice = candles.slice(-lookback);
  const rangeHigh = Math.max(...slice.map(candle => candle.high));
  const rangeLow = Math.min(...slice.map(candle => candle.low));
  const equilibrium = (rangeHigh + rangeLow) / 2;
  const currentPrice = candles.at(-1)?.close ?? equilibrium;
  const priceRange = Math.max(rangeHigh - rangeLow, 0.0000001);
  const pct = ((currentPrice - rangeLow) / priceRange) * 100;
  const zone = pct > 60 ? "premium" : pct < 40 ? "discount" : "equilibrium";

  return {
    equilibrium,
    rangeHigh,
    rangeLow,
    zone,
    pct,
  };
}

function buildZoneCandidates(input: {
  timeframe: PriceZoneCandidate["timeframe"];
  candles: Candle[];
  blocks: OrderBlock[];
  fvgs: FairValueGap[];
  breakers: BreakerBlock[];
  sdZones: SDZone[];
}): PriceZoneCandidate[] {
  const swingHighs = extractSwingHighs(input.candles, 2).slice(-3);
  const swingLows = extractSwingLows(input.candles, 2).slice(-3);
  const candidates: PriceZoneCandidate[] = [];

  for (const block of input.blocks) {
    candidates.push({
      kind: "order_block",
      timeframe: input.timeframe,
      direction: block.type,
      low: block.low,
      high: block.high,
      weight: block.strength,
      label: `${input.timeframe.toUpperCase()} ${titleCase(block.type)} order block`,
    });
  }

  for (const gap of input.fvgs) {
    candidates.push({
      kind: "fvg",
      timeframe: input.timeframe,
      direction: gap.type,
      low: gap.low,
      high: gap.high,
      weight: 72,
      label: `${input.timeframe.toUpperCase()} ${titleCase(gap.type)} FVG`,
    });
  }

  for (const breaker of input.breakers) {
    candidates.push({
      kind: "breaker",
      timeframe: input.timeframe,
      direction: breaker.type,
      low: breaker.low,
      high: breaker.high,
      weight: 68,
      label: `${input.timeframe.toUpperCase()} ${titleCase(breaker.type)} breaker`,
    });
  }

  for (const zone of input.sdZones) {
    candidates.push({
      kind: "sd_zone",
      timeframe: input.timeframe,
      direction: zone.type === "demand" ? "bullish" : "bearish",
      low: zone.low,
      high: zone.high,
      weight: zone.strength,
      label: `${input.timeframe.toUpperCase()} ${titleCase(zone.type)} zone`,
    });
  }

  for (const swingHigh of swingHighs) {
    const width = Math.max((input.candles.at(-1)?.close ?? swingHigh.price) * 0.001, 0.0000001);
    candidates.push({
      kind: "swing",
      timeframe: input.timeframe,
      direction: "bearish",
      low: swingHigh.price - width,
      high: swingHigh.price + width,
      weight: 60,
      label: `${input.timeframe.toUpperCase()} swing high liquidity`,
    });
  }

  for (const swingLow of swingLows) {
    const width = Math.max((input.candles.at(-1)?.close ?? swingLow.price) * 0.001, 0.0000001);
    candidates.push({
      kind: "swing",
      timeframe: input.timeframe,
      direction: "bullish",
      low: swingLow.price - width,
      high: swingLow.price + width,
      weight: 60,
      label: `${input.timeframe.toUpperCase()} swing low liquidity`,
    });
  }

  return candidates;
}

function zoneOverlaps(left: ZoneRange | null, right: PriceZoneCandidate | null): boolean {
  if (!left || !right) {
    return false;
  }
  return right.low <= left.high && right.high >= left.low;
}

function zoneWidth(zone: PriceZoneCandidate): number {
  return Math.max(zone.high - zone.low, Math.abs(zone.high) * 0.0005, 0.0000001);
}

function zoneIsInEntryCorridor(
  direction: "LONG" | "SHORT",
  livePrice: number,
  zone: PriceZoneCandidate,
): boolean {
  const buffer = Math.max(zoneWidth(zone) * 0.5, Math.abs(livePrice) * 0.0004);
  return direction === "LONG"
    ? zone.low <= livePrice + buffer
    : zone.high >= livePrice - buffer;
}

function filterEntryCorridorZones(input: {
  direction: "LONG" | "SHORT";
  livePrice: number;
  zones: PriceZoneCandidate[];
}): PriceZoneCandidate[] {
  const targetDirection = input.direction === "LONG" ? "bullish" : "bearish";
  const directional = input.zones.filter(zone => zone.direction === targetDirection);
  const inCorridor = directional.filter(zone => zoneIsInEntryCorridor(input.direction, input.livePrice, zone));
  return inCorridor.length > 0 ? inCorridor : directional;
}

export function pickBestEntryZone(input: {
  direction: "LONG" | "SHORT";
  livePrice: number;
  htfZones: PriceZoneCandidate[];
  mtfZones: PriceZoneCandidate[];
}): { htfZone: PriceZoneCandidate | null; mtfZone: PriceZoneCandidate | null } {
  const qualifyingHtf = filterEntryCorridorZones({
    direction: input.direction,
    livePrice: input.livePrice,
    zones: input.htfZones,
  })
    .sort((left, right) => {
      const leftDistance = input.direction === "LONG"
        ? Math.abs(input.livePrice - left.high)
        : Math.abs(left.low - input.livePrice);
      const rightDistance = input.direction === "LONG"
        ? Math.abs(input.livePrice - right.high)
        : Math.abs(right.low - input.livePrice);
      return leftDistance - rightDistance || right.weight - left.weight;
    });
  const chosenHtf = qualifyingHtf[0] ?? null;

  const qualifyingMtf = filterEntryCorridorZones({
    direction: input.direction,
    livePrice: input.livePrice,
    zones: input.mtfZones,
  })
    .sort((left, right) => {
      const leftOverlapBonus = zoneOverlaps(
        chosenHtf ? { low: chosenHtf.low, high: chosenHtf.high, label: chosenHtf.label } : null,
        left,
      ) ? -20 : 0;
      const rightOverlapBonus = zoneOverlaps(
        chosenHtf ? { low: chosenHtf.low, high: chosenHtf.high, label: chosenHtf.label } : null,
        right,
      ) ? -20 : 0;
      const leftDistance = input.direction === "LONG"
        ? Math.abs(input.livePrice - left.high)
        : Math.abs(left.low - input.livePrice);
      const rightDistance = input.direction === "LONG"
        ? Math.abs(input.livePrice - right.high)
        : Math.abs(right.low - input.livePrice);
      return (leftDistance + leftOverlapBonus) - (rightDistance + rightOverlapBonus) || right.weight - left.weight;
    });

  return {
    htfZone: chosenHtf,
    mtfZone: qualifyingMtf[0] ?? null,
  };
}

function zoneTouched(candle: Candle, zone: ZoneRange | null): boolean {
  if (!zone) {
    return false;
  }
  return candle.low <= zone.high && candle.high >= zone.low;
}

function findReferenceLevels(candles: Candle[], direction: "LONG" | "SHORT", index: number): number[] {
  const window = candles.slice(Math.max(0, index - 24), index);
  const swingLevels = direction === "LONG"
    ? extractSwingLows(window, 2).map(level => level.price)
    : extractSwingHighs(window, 2).map(level => level.price);
  const rollingLevel = direction === "LONG"
    ? Math.min(...window.slice(-5).map(candle => candle.low))
    : Math.max(...window.slice(-5).map(candle => candle.high));

  return [
    ...swingLevels,
    ...(Number.isFinite(rollingLevel) ? [rollingLevel] : []),
  ].filter(level => Number.isFinite(level));
}

function confirmBullishShift(candles: Candle[], sweepIndex: number, sweepLevel: number): {
  index: number;
  label: SweepCandidate["confirmationLabel"];
} | null {
  const sweepCandle = candles[sweepIndex];
  if (!sweepCandle) {
    return null;
  }

  if (isBullishRejection(sweepCandle) && sweepCandle.close > sweepLevel) {
    return { index: sweepIndex, label: "rejection" };
  }

  for (let index = sweepIndex + 1; index <= Math.min(candles.length - 1, sweepIndex + 2); index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (!current || !previous) {
      continue;
    }

    if (isBullishEngulfing(previous, current)) {
      return { index, label: "engulfing" };
    }

    const recentHigh = Math.max(...candles.slice(Math.max(0, sweepIndex - 2), index).map(candle => candle.high));
    if (current.close > recentHigh) {
      return { index, label: "mss" };
    }
  }

  return null;
}

function confirmBearishShift(candles: Candle[], sweepIndex: number, sweepLevel: number): {
  index: number;
  label: SweepCandidate["confirmationLabel"];
} | null {
  const sweepCandle = candles[sweepIndex];
  if (!sweepCandle) {
    return null;
  }

  if (isBearishRejection(sweepCandle) && sweepCandle.close < sweepLevel) {
    return { index: sweepIndex, label: "rejection" };
  }

  for (let index = sweepIndex + 1; index <= Math.min(candles.length - 1, sweepIndex + 2); index += 1) {
    const current = candles[index];
    const previous = candles[index - 1];
    if (!current || !previous) {
      continue;
    }

    if (isBearishEngulfing(previous, current)) {
      return { index, label: "engulfing" };
    }

    const recentLow = Math.min(...candles.slice(Math.max(0, sweepIndex - 2), index).map(candle => candle.low));
    if (current.close < recentLow) {
      return { index, label: "mss" };
    }
  }

  return null;
}

function detectSweepCandidate(input: {
  symbol: string;
  direction: "LONG" | "SHORT";
  candles: Candle[];
  timeframe: "5m" | "15m";
  zone: ZoneRange | null;
}): SweepCandidate | null {
  const { candles, direction } = input;
  if (candles.length < 12 || !input.zone) {
    return null;
  }
  const zone = input.zone;

  const tolerance = Math.max(pipBuffer(input.symbol, candles.at(-1)?.close ?? 1) * 0.35, atr(candles, 14) * 0.04);
  const zoneStartIndex = candles.findIndex(candle => zoneTouched(candle, zone));
  if (zoneStartIndex < 0) {
    return null;
  }

  for (let index = Math.max(5, zoneStartIndex); index < candles.length - 1; index += 1) {
    const candle = candles[index];
    if (!zoneTouched(candle, zone)) {
      continue;
    }

    const referenceLevels = findReferenceLevels(candles, direction, index);
    if (referenceLevels.length === 0) {
      continue;
    }

    if (direction === "LONG") {
      const sweepLevel = Math.max(...referenceLevels.filter(level => level >= zone.low - tolerance && level <= candle.low + atr(candles, 14)));
      if (!Number.isFinite(sweepLevel)) {
        continue;
      }
      const swept = candle.low < (sweepLevel - tolerance) && candle.close > sweepLevel;
      if (!swept) {
        continue;
      }
      const confirmation = confirmBullishShift(candles, index, sweepLevel);
      if (!confirmation) {
        continue;
      }
      const entryCandle = candles[confirmation.index];
      const stopBuffer = Math.max(pipBuffer(input.symbol, entryCandle.close), atr(candles, 14) * 0.12);
      return {
        entryTimeframe: input.timeframe,
        entry: entryCandle.close,
        stopLoss: candle.low - stopBuffer,
        sweepLevel,
        sweepExtreme: candle.low,
        sweepIndex: index,
        confirmationIndex: confirmation.index,
        confirmationLabel: confirmation.label,
        sweepDescription: `Sell-side liquidity at ${formatPrice(sweepLevel, input.symbol)} was swept before a ${confirmation.label} confirmation closed.`,
      };
    }

    const sweepLevel = Math.min(...referenceLevels.filter(level => level <= zone.high + tolerance && level >= candle.high - atr(candles, 14)));
    if (!Number.isFinite(sweepLevel)) {
      continue;
    }
    const swept = candle.high > (sweepLevel + tolerance) && candle.close < sweepLevel;
    if (!swept) {
      continue;
    }
    const confirmation = confirmBearishShift(candles, index, sweepLevel);
    if (!confirmation) {
      continue;
    }
    const entryCandle = candles[confirmation.index];
    const stopBuffer = Math.max(pipBuffer(input.symbol, entryCandle.close), atr(candles, 14) * 0.12);
    return {
      entryTimeframe: input.timeframe,
      entry: entryCandle.close,
      stopLoss: candle.high + stopBuffer,
      sweepLevel,
      sweepExtreme: candle.high,
      sweepIndex: index,
      confirmationIndex: confirmation.index,
      confirmationLabel: confirmation.label,
      sweepDescription: `Buy-side liquidity at ${formatPrice(sweepLevel, input.symbol)} was swept before a ${confirmation.label} confirmation closed.`,
    };
  }

  return null;
}

function pickTargetZones(input: {
  direction: "LONG" | "SHORT";
  entry: number;
  mtfZones: PriceZoneCandidate[];
  htfZones: PriceZoneCandidate[];
}): { tp1: PriceZoneCandidate | null; tp2: PriceZoneCandidate | null } {
  const targetDirection = input.direction === "LONG" ? "bearish" : "bullish";
  const forwardComparator = (zone: PriceZoneCandidate): boolean => (
    input.direction === "LONG" ? zone.high > input.entry : zone.low < input.entry
  );

  const mtfTargets = input.mtfZones
    .filter(zone => zone.direction === targetDirection && forwardComparator(zone))
    .sort((left, right) => input.direction === "LONG" ? left.low - right.low : right.high - left.high);
  const tp1 = mtfTargets[0] ?? null;

  const htfTargets = input.htfZones
    .filter(zone => zone.direction === targetDirection && forwardComparator(zone))
    .sort((left, right) => input.direction === "LONG" ? left.low - right.low : right.high - left.high);

  const tp2 = htfTargets.find(zone => {
    if (!tp1) {
      return true;
    }
    return input.direction === "LONG" ? zone.low > tp1.high : zone.high < tp1.low;
  }) ?? null;

  return { tp1, tp2 };
}

function buildZoneRange(zone: PriceZoneCandidate | null): ZoneRange | null {
  if (!zone) {
    return null;
  }
  return {
    low: zone.low,
    high: zone.high,
    label: zone.label,
  };
}

function midpoint(zone: PriceZoneCandidate | null, fallback: number): number {
  if (!zone) {
    return fallback;
  }
  return (zone.low + zone.high) / 2;
}

function computeHtfAlignmentScore(input: {
  dailyBias: Bias;
  h4Bias: Bias;
  weeklyBias: Bias;
  monthlyBias: Bias;
  overallBias: Bias;
  dailyStructure: StructureState;
  h4Structure: StructureState;
}): number {
  if (input.overallBias === "ranging") {
    return 0;
  }

  let score = 8;
  if (input.dailyBias === input.overallBias) score += 4;
  if (input.h4Bias === input.overallBias) score += 4;
  if (input.weeklyBias === input.overallBias) score += 2;
  if (input.monthlyBias === input.overallBias) score += 1;
  if (
    (input.overallBias === "bullish" && input.dailyStructure.pattern === "HH/HL" && input.h4Structure.pattern === "HH/HL")
    || (input.overallBias === "bearish" && input.dailyStructure.pattern === "LH/LL" && input.h4Structure.pattern === "LH/LL")
  ) {
    score += 1;
  }
  return clamp(score, 0, 20);
}

function computeStopPlacementScore(entry: number, stopLoss: number, symbol: string, ltfCandles: Candle[]): number {
  const risk = Math.abs(entry - stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) {
    return 0;
  }

  const ltfAtr = Math.max(atr(ltfCandles, 14), pipBuffer(symbol, entry));
  const ratio = risk / ltfAtr;
  if (ratio <= 0.35) return 20;
  if (ratio <= 0.5) return 17;
  if (ratio <= 0.75) return 14;
  if (ratio <= 1.0) return 10;
  return 6;
}

function computeRrScore(rr: number): number {
  if (rr >= 5) return 20;
  if (rr >= 4.25) return 18;
  if (rr >= 3.75) return 16;
  if (rr >= 3.25) return 15;
  if (rr >= 3) return 14;
  return 0;
}

function summarizeBias(input: {
  overallBias: Bias;
  dailyStructure: StructureState;
  h4Structure: StructureState;
  dailyBias: Bias;
  h4Bias: Bias;
}): string {
  if (input.overallBias === "ranging") {
    return "Higher timeframes are mixed, so directional bias is withheld.";
  }

  return `${titleCase(input.overallBias)} bias from Daily ${describeStructure(input.dailyStructure.pattern, input.dailyBias)} and H4 ${describeStructure(input.h4Structure.pattern, input.h4Bias)} structure.`;
}

function overallBiasFromStructures(input: {
  monthlyBias: Bias;
  weeklyBias: Bias;
  dailyBias: Bias;
  h4Bias: Bias;
}): { overallBias: Bias; biasStrength: number } {
  const weights: Array<{ bias: Bias; weight: number }> = [
    { bias: input.dailyBias, weight: 0.4 },
    { bias: input.h4Bias, weight: 0.35 },
    { bias: input.weeklyBias, weight: 0.15 },
    { bias: input.monthlyBias, weight: 0.1 },
  ];

  let bullishWeight = 0;
  let bearishWeight = 0;
  for (const item of weights) {
    if (item.bias === "bullish") bullishWeight += item.weight;
    if (item.bias === "bearish") bearishWeight += item.weight;
  }

  if (bullishWeight >= 0.6) {
    return { overallBias: "bullish", biasStrength: Math.round(bullishWeight * 100) };
  }
  if (bearishWeight >= 0.6) {
    return { overallBias: "bearish", biasStrength: Math.round(bearishWeight * 100) };
  }
  return { overallBias: "ranging", biasStrength: Math.round(Math.max(bullishWeight, bearishWeight) * 100) };
}

function reasonForNeutral(input: {
  symbol: string;
  overallBias: Bias;
  biasStrength: number;
  zone: ZoneRange | null;
  sweep: SweepCandidate | null;
  rr: number;
}): string {
  if (input.overallBias === "ranging") {
    return `${input.symbol}: Higher-timeframe structure is mixed, so no directional bias is active.`;
  }
  if (!input.zone) {
    return `${input.symbol}: Higher-timeframe bias is clear, but price is not reacting inside an aligned HTF/MTF zone yet.`;
  }
  if (!input.sweep) {
    return `${input.symbol}: ${titleCase(input.overallBias)} bias is active, but no lower-timeframe liquidity sweep plus confirmation has closed inside the reaction zone yet.`;
  }
  if (input.rr > 0 && input.rr < 3) {
    return `${input.symbol}: The sweep setup formed, but TP1 only offers ${input.rr.toFixed(2)}R which fails the 1:3 floor.`;
  }
  return `${input.symbol}: Top-down bias is ${input.overallBias} with ${input.biasStrength}% alignment, but entry conditions remain incomplete.`;
}

export interface MTFAnalysisResult {
  monthlyBias: Bias;
  weeklyBias: Bias;
  dailyBias: Bias;
  h4Bias: Bias;
  h1Bias: Bias;
  overallBias: Bias;
  biasStrength: number;
  orderBlocks: OrderBlock[];
  fvgs: FairValueGap[];
  breakerBlocks: BreakerBlock[];
  liquiditySweeps: LiquiditySweep[];
  sdZones: SDZone[];
  premiumDiscount: ReturnType<typeof getPremiumDiscount>;
  structureBreaks: StructureBreak[];
  entryConfluence: number;
  entryTrigger: "ob_retest" | "fvg_fill" | "sd_zone" | "liquidity_sweep" | "none";
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidence: number;
  grade: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  reasoning: string;
  timeframe: string;
  setupType: string;
  takeProfit2?: number | null;
  riskReward2?: number | null;
  entryTimeframe?: "5m" | "15m" | null;
  htfBiasSummary?: string;
  liquiditySweepDescription?: string;
  confluenceScore?: number;
  scoreBreakdown?: ConfluenceScoreBreakdown;
  htfZone?: ZoneRange | null;
  mtfZone?: ZoneRange | null;
  tp1Label?: string | null;
  tp2Label?: string | null;
  managementPlan?: {
    partialTakeProfit: string;
    stopAdjustment: string;
    runnerPlan: string;
  };
}

function logMtfScoringInput(symbol: string, mtf: MTFCandles, livePrice: number): void {
  console.log(
    `[MTF SCORE INPUT] ${symbol}: livePrice=${Number.isFinite(livePrice) ? formatPrice(livePrice, symbol) : "invalid"} mo=${mtf.monthly.length} wk=${mtf.weekly.length} d=${mtf.daily.length} h4=${mtf.h4.length} h1=${mtf.h1.length} m15=${mtf.m15.length} m5=${mtf.m5.length}`,
  );
}

export function runTopDownAnalysis(
  symbol: string,
  mtf: MTFCandles,
  livePrice: number,
): MTFAnalysisResult | null {
  logMtfScoringInput(symbol, mtf, livePrice);

  if (!Number.isFinite(livePrice) || livePrice <= 0) {
    console.log(`[MTF SCORE INPUT] ${symbol}: invalid live price, skipping analysis`);
    return null;
  }
  if (mtf.daily.length < 20 || mtf.h4.length < 20 || mtf.h1.length < 20 || mtf.m15.length < 24 || mtf.m5.length < 24) {
    console.log(
      `[MTF SCORE INPUT] ${symbol}: insufficient candles for analysis (d=${mtf.daily.length} h4=${mtf.h4.length} h1=${mtf.h1.length} m15=${mtf.m15.length} m5=${mtf.m5.length})`,
    );
    return null;
  }

  const monthlyBias = mtf.monthly.length >= 4 ? detectBias(mtf.monthly, 6) : "ranging";
  const weeklyBias = mtf.weekly.length >= 8 ? detectBias(mtf.weekly, 12) : "ranging";
  const dailyStructure = analyzeStructure(mtf.daily);
  const h4Structure = analyzeStructure(mtf.h4);
  const h1Structure = analyzeStructure(mtf.h1);
  const m30 = aggregateCandles(mtf.m15, 30 * 60 * 1000);

  const dailyBias = dailyStructure.bias;
  const h4Bias = h4Structure.bias;
  const h1Bias = h1Structure.bias;
  const { overallBias, biasStrength } = overallBiasFromStructures({
    monthlyBias,
    weeklyBias,
    dailyBias,
    h4Bias,
  });

  const dailyOrderBlocks = detectOrderBlocks(mtf.daily);
  const dailyFvgs = detectFVGs(mtf.daily);
  const dailyBreakers = detectBreakerBlocks(mtf.daily, dailyOrderBlocks);
  const dailySdZones = detectSDZones(mtf.daily);
  const h4OrderBlocks = detectOrderBlocks(mtf.h4);
  const h4Fvgs = detectFVGs(mtf.h4);
  const h4Breakers = detectBreakerBlocks(mtf.h4, h4OrderBlocks);
  const h4SdZones = detectSDZones(mtf.h4);
  const h1OrderBlocks = detectOrderBlocks(mtf.h1);
  const h1Fvgs = detectFVGs(mtf.h1);
  const h1Breakers = detectBreakerBlocks(mtf.h1, h1OrderBlocks);
  const h1SdZones = detectSDZones(mtf.h1);
  const m30OrderBlocks = detectOrderBlocks(m30);
  const m30Fvgs = detectFVGs(m30);
  const m30Breakers = detectBreakerBlocks(m30, m30OrderBlocks);
  const m30SdZones = detectSDZones(m30);
  const premiumDiscount = getPremiumDiscount(mtf.daily, 50);
  const structureBreaks = detectStructureBreaks(mtf.m15);
  const liquiditySweeps = detectLiquiditySweeps(mtf.m15);

  const orderBlocks = [...dailyOrderBlocks.slice(-2), ...h4OrderBlocks.slice(-2), ...h1OrderBlocks.slice(-2), ...m30OrderBlocks.slice(-2)];
  const fvgs = [...dailyFvgs.slice(-2), ...h4Fvgs.slice(-2), ...h1Fvgs.slice(-2), ...m30Fvgs.slice(-2)];
  const breakerBlocks = [...dailyBreakers.slice(-1), ...h4Breakers.slice(-1), ...h1Breakers.slice(-2), ...m30Breakers.slice(-2)];
  const sdZones = [...dailySdZones.slice(-2), ...h4SdZones.slice(-2), ...h1SdZones.slice(-2), ...m30SdZones.slice(-2)];

  const neutralBase: MTFAnalysisResult = {
    monthlyBias,
    weeklyBias,
    dailyBias,
    h4Bias,
    h1Bias,
    overallBias,
    biasStrength,
    orderBlocks,
    fvgs,
    breakerBlocks,
    liquiditySweeps,
    sdZones,
    premiumDiscount,
    structureBreaks,
    entryConfluence: 0,
    entryTrigger: "none",
    direction: "NEUTRAL",
    confidence: 0,
    grade: "F",
    entry: formatPrice(livePrice, symbol),
    stopLoss: formatPrice(livePrice, symbol),
    takeProfit: formatPrice(livePrice, symbol),
    riskReward: 0,
    reasoning: reasonForNeutral({
      symbol,
      overallBias,
      biasStrength,
      zone: null,
      sweep: null,
      rr: 0,
    }),
    timeframe: "15m",
    setupType: "awaiting_liquidity_sweep",
    takeProfit2: null,
    riskReward2: null,
    entryTimeframe: null,
    htfBiasSummary: summarizeBias({
      overallBias,
      dailyStructure,
      h4Structure,
      dailyBias,
      h4Bias,
    }),
    liquiditySweepDescription: "No qualifying lower-timeframe sweep has confirmed yet.",
    confluenceScore: 0,
    scoreBreakdown: {
      htfAlignment: 0,
      liquiditySweepPresence: 0,
      ltfConfirmation: 0,
      tightStopPlacement: 0,
      rrQuality: 0,
    },
    htfZone: null,
    mtfZone: null,
    tp1Label: null,
    tp2Label: null,
    managementPlan: {
      partialTakeProfit: "Close 50-70% at TP1.",
      stopAdjustment: "Move stop to breakeven after TP1.",
      runnerPlan: "Let the remainder run to TP2.",
    },
  };

  if (overallBias === "ranging") {
    return neutralBase;
  }

  const direction = overallBias === "bullish" ? "LONG" : "SHORT";
  const htfZones = [
    ...buildZoneCandidates({
      timeframe: "1d",
      candles: mtf.daily,
      blocks: dailyOrderBlocks,
      fvgs: dailyFvgs,
      breakers: dailyBreakers,
      sdZones: dailySdZones,
    }),
    ...buildZoneCandidates({
      timeframe: "4h",
      candles: mtf.h4,
      blocks: h4OrderBlocks,
      fvgs: h4Fvgs,
      breakers: h4Breakers,
      sdZones: h4SdZones,
    }),
  ];
  const mtfZones = [
    ...buildZoneCandidates({
      timeframe: "1h",
      candles: mtf.h1,
      blocks: h1OrderBlocks,
      fvgs: h1Fvgs,
      breakers: h1Breakers,
      sdZones: h1SdZones,
    }),
    ...buildZoneCandidates({
      timeframe: "30m",
      candles: m30,
      blocks: m30OrderBlocks,
      fvgs: m30Fvgs,
      breakers: m30Breakers,
      sdZones: m30SdZones,
    }),
  ];

  const selectedZones = pickBestEntryZone({
    direction,
    livePrice,
    htfZones,
    mtfZones,
  });
  const htfZoneRange = buildZoneRange(selectedZones.htfZone);
  const mtfZoneRange = buildZoneRange(selectedZones.mtfZone);
  const activeZone = mtfZoneRange ?? htfZoneRange;

  const m5Sweep = detectSweepCandidate({
    symbol,
    direction,
    candles: mtf.m5,
    timeframe: "5m",
    zone: activeZone,
  });
  const m15Sweep = detectSweepCandidate({
    symbol,
    direction,
    candles: mtf.m15,
    timeframe: "15m",
    zone: activeZone,
  });
  const sweep = m5Sweep ?? m15Sweep;

  const zoneMidpoint = midpoint(selectedZones.mtfZone ?? selectedZones.htfZone, livePrice);
  const targets = pickTargetZones({
    direction,
    entry: sweep?.entry ?? zoneMidpoint,
    mtfZones,
    htfZones,
  });

  const tp1Reference = direction === "LONG"
    ? targets.tp1?.low ?? targets.tp2?.low ?? livePrice + Math.max(atr(mtf.h1, 14) * 3.5, livePrice * 0.015)
    : targets.tp1?.high ?? targets.tp2?.high ?? livePrice - Math.max(atr(mtf.h1, 14) * 3.5, livePrice * 0.015);
  const tp2Reference = direction === "LONG"
    ? targets.tp2?.low ?? ((targets.tp1?.high ?? livePrice) + Math.max(atr(mtf.h4, 14) * 2.5, livePrice * 0.02))
    : targets.tp2?.high ?? ((targets.tp1?.low ?? livePrice) - Math.max(atr(mtf.h4, 14) * 2.5, livePrice * 0.02));

  const rr = sweep ? calculateRiskReward(sweep.entry, sweep.stopLoss, tp1Reference) : 0;
  if (!sweep || rr < 3) {
    return {
      ...neutralBase,
      reasoning: reasonForNeutral({
        symbol,
        overallBias,
        biasStrength,
        zone: activeZone,
        sweep,
        rr,
      }),
      htfZone: htfZoneRange,
      mtfZone: mtfZoneRange,
      liquiditySweepDescription: sweep?.sweepDescription ?? neutralBase.liquiditySweepDescription,
    };
  }

  const rr2 = calculateRiskReward(sweep.entry, sweep.stopLoss, tp2Reference);
  const scoreBreakdown: ConfluenceScoreBreakdown = {
    htfAlignment: computeHtfAlignmentScore({
      dailyBias,
      h4Bias,
      weeklyBias,
      monthlyBias,
      overallBias,
      dailyStructure,
      h4Structure,
    }),
    liquiditySweepPresence: 20,
    ltfConfirmation: sweep.confirmationLabel === "mss" ? 20 : sweep.confirmationLabel === "engulfing" ? 18 : 16,
    tightStopPlacement: computeStopPlacementScore(
      sweep.entry,
      sweep.stopLoss,
      symbol,
      sweep.entryTimeframe === "5m" ? mtf.m5 : mtf.m15,
    ),
    rrQuality: computeRrScore(rr),
  };
  const confluenceScore = clamp(
    scoreBreakdown.htfAlignment
      + scoreBreakdown.liquiditySweepPresence
      + scoreBreakdown.ltfConfirmation
      + scoreBreakdown.tightStopPlacement
      + scoreBreakdown.rrQuality,
    0,
    100,
  );
  const grade = gradeFromConfluenceScore(confluenceScore);
  const chosenTakeProfit = formatPrice(tp1Reference, symbol);
  const chosenTakeProfit2 = formatPrice(tp2Reference, symbol);
  const entryPrice = formatPrice(sweep.entry, symbol);
  const stopLoss = formatPrice(sweep.stopLoss, symbol);
  const entryConfluence = clamp(
    scoreBreakdown.liquiditySweepPresence
      + scoreBreakdown.ltfConfirmation
      + (selectedZones.mtfZone ? 10 : 0),
    0,
    100,
  );

  return {
    monthlyBias,
    weeklyBias,
    dailyBias,
    h4Bias,
    h1Bias,
    overallBias,
    biasStrength,
    orderBlocks,
    fvgs,
    breakerBlocks,
    liquiditySweeps,
    sdZones,
    premiumDiscount,
    structureBreaks,
    entryConfluence,
    entryTrigger: "liquidity_sweep",
    direction,
    confidence: confluenceScore,
    grade,
    entry: entryPrice,
    stopLoss,
    takeProfit: chosenTakeProfit,
    riskReward: Number(rr.toFixed(2)),
    reasoning: `${symbol} ${direction}: ${summarizeBias({
      overallBias,
      dailyStructure,
      h4Structure,
      dailyBias,
      h4Bias,
    })} Entry is only valid after the ${sweep.entryTimeframe} sweep and ${sweep.confirmationLabel} confirmation.`,
    timeframe: sweep.entryTimeframe,
    setupType: "liquidity_sweep_reversal",
    takeProfit2: chosenTakeProfit2,
    riskReward2: Number(rr2.toFixed(2)),
    entryTimeframe: sweep.entryTimeframe,
    htfBiasSummary: summarizeBias({
      overallBias,
      dailyStructure,
      h4Structure,
      dailyBias,
      h4Bias,
    }),
    liquiditySweepDescription: sweep.sweepDescription,
    confluenceScore,
    scoreBreakdown,
    htfZone: htfZoneRange,
    mtfZone: mtfZoneRange,
    tp1Label: targets.tp1?.label ?? null,
    tp2Label: targets.tp2?.label ?? null,
    managementPlan: {
      partialTakeProfit: "Close 50-70% at TP1.",
      stopAdjustment: "Move stop to breakeven after TP1.",
      runnerPlan: "Hold the remainder for TP2.",
    },
  };
}
