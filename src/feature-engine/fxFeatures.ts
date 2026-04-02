import type {
  DirectionalState,
  EconomicEventContext,
  MarketStructureContext,
  PairVolatilityRegime,
  SessionCompressionState,
  SessionContext,
  SessionFeatureContext,
  SessionLabel,
  StructureBias,
  TradeabilityContext,
  TradeabilityVolatilityState,
} from "@/src/interfaces/contracts";
import { atr, mean } from "@/src/feature-engine/indicators";

export interface ObservedBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  bid: number;
  ask: number;
  timestampOpen: number;
  timestampClose: number;
  session: SessionContext;
  economicEvent: EconomicEventContext;
}

type SwingPoint = {
  price: number;
  timestamp: number;
};

function maxHigh(bars: ObservedBar[]): number {
  return bars.reduce((highest, bar) => Math.max(highest, bar.high), Number.NEGATIVE_INFINITY);
}

function minLow(bars: ObservedBar[]): number {
  return bars.reduce((lowest, bar) => Math.min(lowest, bar.low), Number.POSITIVE_INFINITY);
}

function findSwingHighs(bars: ObservedBar[], window = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let index = window; index < bars.length - window; index += 1) {
    const current = bars[index]!;
    const left = bars.slice(index - window, index);
    const right = bars.slice(index + 1, index + window + 1);
    if (left.every(bar => current.high >= bar.high) && right.every(bar => current.high > bar.high)) {
      swings.push({
        price: current.high,
        timestamp: current.timestampClose,
      });
    }
  }
  return swings;
}

function findSwingLows(bars: ObservedBar[], window = 2): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let index = window; index < bars.length - window; index += 1) {
    const current = bars[index]!;
    const left = bars.slice(index - window, index);
    const right = bars.slice(index + 1, index + window + 1);
    if (left.every(bar => current.low <= bar.low) && right.every(bar => current.low < bar.low)) {
      swings.push({
        price: current.low,
        timestamp: current.timestampClose,
      });
    }
  }
  return swings;
}

function resolveStructureBias(recentHigh: SwingPoint | null, previousHigh: SwingPoint | null, recentLow: SwingPoint | null, previousLow: SwingPoint | null): StructureBias {
  const higherHighState = recentHigh != null && previousHigh != null && recentHigh.price > previousHigh.price;
  const higherLowState = recentLow != null && previousLow != null && recentLow.price > previousLow.price;
  const lowerHighState = recentHigh != null && previousHigh != null && recentHigh.price < previousHigh.price;
  const lowerLowState = recentLow != null && previousLow != null && recentLow.price < previousLow.price;

  if (higherHighState && higherLowState) {
    return "bullish";
  }
  if (lowerHighState && lowerLowState) {
    return "bearish";
  }
  return "neutral";
}

function resolveBreakState(latestClose: number, highReference: number | null, lowReference: number | null, threshold: number): DirectionalState {
  if (highReference != null && latestClose > highReference + threshold) {
    return "bullish";
  }
  if (lowReference != null && latestClose < lowReference - threshold) {
    return "bearish";
  }
  return "none";
}

function absoluteDistance(from: number, to: number | null): number {
  return to == null ? 0 : Math.abs(from - to);
}

function getTradingDayBars(bars: ObservedBar[], tradingDay: string): ObservedBar[] {
  return bars.filter(bar => bar.session.tradingDay === tradingDay);
}

function getSessionBars(bars: ObservedBar[], tradingDay: string, session: SessionLabel): ObservedBar[] {
  return bars.filter(bar => bar.session.tradingDay === tradingDay && bar.session.session === session);
}

function getPreviousTradingDay(bars: ObservedBar[], currentTradingDay: string): string | null {
  const days = [...new Set(bars.map(bar => bar.session.tradingDay).filter(day => day < currentTradingDay))].sort();
  return days.at(-1) ?? null;
}

export function computeMarketStructure(input: {
  bars: ObservedBar[];
  latestPrice: number;
  atr14: number;
}): MarketStructureContext {
  const swingsHigh = findSwingHighs(input.bars.slice(-120));
  const swingsLow = findSwingLows(input.bars.slice(-120));
  const recentSwingHigh = swingsHigh.at(-1) ?? null;
  const previousSwingHigh = swingsHigh.at(-2) ?? null;
  const recentSwingLow = swingsLow.at(-1) ?? null;
  const previousSwingLow = swingsLow.at(-2) ?? null;
  const structureBias = resolveStructureBias(recentSwingHigh, previousSwingHigh, recentSwingLow, previousSwingLow);
  const breakOfStructure = resolveBreakState(
    input.latestPrice,
    previousSwingHigh?.price ?? recentSwingHigh?.price ?? null,
    previousSwingLow?.price ?? recentSwingLow?.price ?? null,
    Math.max(input.atr14 * 0.1, input.latestPrice * 0.00025),
  );
  const changeOfCharacter = structureBias === "bearish" && breakOfStructure === "bullish"
    ? "bullish"
    : structureBias === "bullish" && breakOfStructure === "bearish"
      ? "bearish"
      : "none";
  const currentTradingDay = input.bars.at(-1)?.session.tradingDay ?? "";
  const currentSession = input.bars.at(-1)?.session.session ?? "off_hours";
  const currentSessionBars = getSessionBars(input.bars, currentTradingDay, currentSession);
  const previousTradingDay = getPreviousTradingDay(input.bars, currentTradingDay);
  const previousDayBars = previousTradingDay ? getTradingDayBars(input.bars, previousTradingDay) : [];
  const sessionHigh = currentSessionBars.length > 0 ? maxHigh(currentSessionBars) : null;
  const sessionLow = currentSessionBars.length > 0 ? minLow(currentSessionBars) : null;
  const previousDayHigh = previousDayBars.length > 0 ? maxHigh(previousDayBars) : null;
  const previousDayLow = previousDayBars.length > 0 ? minLow(previousDayBars) : null;
  const recentStructureDistances = [
    absoluteDistance(input.latestPrice, recentSwingHigh?.price ?? null),
    absoluteDistance(input.latestPrice, recentSwingLow?.price ?? null),
  ].filter(distance => distance > 0);

  return {
    recentSwingHigh: recentSwingHigh?.price ?? null,
    recentSwingLow: recentSwingLow?.price ?? null,
    previousSwingHigh: previousSwingHigh?.price ?? null,
    previousSwingLow: previousSwingLow?.price ?? null,
    higherHighState: recentSwingHigh != null && previousSwingHigh != null && recentSwingHigh.price > previousSwingHigh.price,
    lowerLowState: recentSwingLow != null && previousSwingLow != null && recentSwingLow.price < previousSwingLow.price,
    structureBias,
    breakOfStructure,
    changeOfCharacter,
    distanceToRecentStructure: recentStructureDistances.length > 0 ? Math.min(...recentStructureDistances) : 0,
    distanceToSessionHigh: absoluteDistance(input.latestPrice, sessionHigh),
    distanceToSessionLow: absoluteDistance(input.latestPrice, sessionLow),
    distanceToPreviousDayHigh: absoluteDistance(input.latestPrice, previousDayHigh),
    distanceToPreviousDayLow: absoluteDistance(input.latestPrice, previousDayLow),
  };
}

function resolveSessionBreakoutState(sessionBars: ObservedBar[], latestClose: number, atr14: number): DirectionalState {
  if (sessionBars.length < 4) {
    return "none";
  }
  const priorBars = sessionBars.slice(0, -1);
  const threshold = Math.max(atr14 * 0.1, latestClose * 0.0002);
  if (latestClose > maxHigh(priorBars) + threshold) {
    return "bullish";
  }
  if (latestClose < minLow(priorBars) - threshold) {
    return "bearish";
  }
  return "none";
}

function resolveCompressionState(rangeSize: number, atr14: number, latestPrice: number): SessionCompressionState {
  const baseline = Math.max(atr14, latestPrice * 0.0008);
  return rangeSize / Math.max(baseline, 0.0001) < 1.15 ? "compressed" : "normal";
}

export function computeSessionFeatures(input: {
  bars: ObservedBar[];
  latestPrice: number;
  atr14: number;
  atrBaseline: number;
}): SessionFeatureContext {
  const latestBar = input.bars.at(-1);
  const currentTradingDay = latestBar?.session.tradingDay ?? "";
  const currentSession = latestBar?.session.session ?? "off_hours";
  const asiaBars = getSessionBars(input.bars, currentTradingDay, "asia");
  const londonBars = getSessionBars(input.bars, currentTradingDay, "london");
  const currentSessionBars = getSessionBars(input.bars, currentTradingDay, currentSession);
  const nyOpenBars = input.bars.filter(bar =>
    bar.session.tradingDay === currentTradingDay &&
    bar.session.session === "overlap" &&
    bar.session.minutesSinceSessionOpen < 60,
  );
  const asiaRangeSize = asiaBars.length > 0 ? maxHigh(asiaBars) - minLow(asiaBars) : 0;
  const londonRangeSize = londonBars.length > 0 ? maxHigh(londonBars) - minLow(londonBars) : 0;
  const newYorkOpeningExpansion = nyOpenBars.length > 0 ? maxHigh(nyOpenBars) - minLow(nyOpenBars) : 0;
  const sessionRange = currentSessionBars.length > 0 ? maxHigh(currentSessionBars) - minLow(currentSessionBars) : 0;
  const atrRelativeToNormal = input.atrBaseline <= 0 ? 1 : input.atr14 / input.atrBaseline;

  return {
    asiaRangeSize,
    londonRangeSize,
    newYorkOpeningExpansion,
    sessionBreakoutState: resolveSessionBreakoutState(currentSessionBars, input.latestPrice, input.atr14),
    sessionCompressionState: resolveCompressionState(sessionRange, input.atr14, input.latestPrice),
    atrRelativeToNormal,
  };
}

function resolveVolatilityState(atrRelativeToNormal: number): TradeabilityVolatilityState {
  if (atrRelativeToNormal < 0.75) {
    return "too_low";
  }
  if (atrRelativeToNormal > 1.6) {
    return "too_high";
  }
  return "acceptable";
}

function resolvePairVolatilityRegime(atrRelativeToNormal: number): PairVolatilityRegime {
  if (atrRelativeToNormal < 0.85) {
    return "low";
  }
  if (atrRelativeToNormal > 1.25) {
    return "high";
  }
  return "normal";
}

export function computeTradeability(input: {
  latestPrice: number;
  atr14: number;
  spreadBps: number;
  structure: MarketStructureContext;
  sessionFeatures: SessionFeatureContext;
  signalCrowdingOnPair: number;
}): TradeabilityContext {
  const upsideCandidates = [
    input.structure.distanceToSessionHigh,
    input.structure.distanceToPreviousDayHigh,
    absoluteDistance(input.latestPrice, input.structure.recentSwingHigh),
  ].filter(value => value > 0);
  const downsideCandidates = [
    input.structure.distanceToSessionLow,
    input.structure.distanceToPreviousDayLow,
    absoluteDistance(input.latestPrice, input.structure.recentSwingLow),
  ].filter(value => value > 0);
  const stopProxy = Math.max(
    input.atr14,
    input.structure.distanceToRecentStructure > 0 && Number.isFinite(input.structure.distanceToRecentStructure)
      ? input.structure.distanceToRecentStructure
      : input.atr14 * 0.75,
    input.latestPrice * 0.0005,
  );
  const rewardToRiskPotential = Math.max(
    ...upsideCandidates,
    ...downsideCandidates,
    0,
  ) / Math.max(stopProxy, 0.0001);
  const proximityToKeyStructure = Math.min(
    input.structure.distanceToRecentStructure,
    input.structure.distanceToSessionHigh || Number.POSITIVE_INFINITY,
    input.structure.distanceToSessionLow || Number.POSITIVE_INFINITY,
    input.structure.distanceToPreviousDayHigh || Number.POSITIVE_INFINITY,
    input.structure.distanceToPreviousDayLow || Number.POSITIVE_INFINITY,
  ) / Math.max(input.atr14, input.latestPrice * 0.0004, 0.0001);

  return {
    spreadEstimateBps: input.spreadBps,
    volatilityState: resolveVolatilityState(input.sessionFeatures.atrRelativeToNormal),
    rewardToRiskFeasible: rewardToRiskPotential >= 1.6,
    rewardToRiskPotential,
    proximityToKeyStructure: Number.isFinite(proximityToKeyStructure) ? proximityToKeyStructure : 0,
    signalCrowdingOnPair: input.signalCrowdingOnPair,
    pairVolatilityRegime: resolvePairVolatilityRegime(input.sessionFeatures.atrRelativeToNormal),
  };
}

export function computeAtrBaseline(bars: ObservedBar[]): number {
  if (bars.length < 20) {
    return 0;
  }
  const highs = bars.map(bar => bar.high);
  const lows = bars.map(bar => bar.low);
  const closes = bars.map(bar => bar.close);
  const samples: number[] = [];
  for (let index = 20; index <= bars.length; index += 1) {
    samples.push(atr(highs.slice(0, index), lows.slice(0, index), closes.slice(0, index), 14));
  }
  return mean(samples.slice(-40));
}
