import type { ApexConfig } from "@/src/lib/config";
import { generateSignalReasoning } from "@/src/lib/apex-llm";
import type { SignalReasoningContext, SignalReasoningOutput } from "@/src/lib/apex-llm/types";
import type { TraderLivePriceMap } from "@/src/lib/livePrices";
import { rescoreSMCAnalysis } from "@/src/smc";
import {
  clamp01,
  type AllocationIntent,
  type FeatureSnapshot,
  type PairMarketDataDiagnostics,
  type PriceZone,
  type RiskDecision,
  type SessionLabel,
  type SignalDirection,
  type SignalLifecycleRecord,
} from "@/src/interfaces/contracts";
import type {
  TraderBias,
  TraderDetailedReasoning,
  TraderDirection,
  TraderKeyAreasRow,
  TraderKeyLevels,
  TraderLiquidityState,
  TraderLiveMarketRow,
  TraderLocation,
  TraderMarketPhase,
  TraderMarketStateLabel,
  TraderMarketReasoningRow,
  TraderNoTradeReason,
  TraderOperatorPreferences,
  TraderPairRuntimeState,
  TraderSetupType,
  TraderDashboardSignal,
  TraderSignalGrade,
  TraderSignalsPayload,
  TraderSignalStatus,
  TraderSnapshotDiagnostics,
  TraderStructureLabel,
  TraderZoneType,
} from "@/src/lib/traderContracts";

/**
 * trader.ts — Cycle-time signal enrichment only.
 * Responsibilities: Claude reasoning generation, SMC field population, grade calculation.
 * NOT responsible for: dashboard payload assembly, API response shaping.
 * Dashboard payloads are built by canonical signal view-model services.
 */

const GRADE_STRENGTH: Record<TraderSignalGrade, number> = {
  F: 0,
  D: 1,
  C: 2,
  B: 3,
  A: 4,
  S: 5,
  "S+": 6,
};

const GRADE_SEQUENCE_ASC: TraderSignalGrade[] = ["F", "D", "C", "B", "A", "S", "S+"];

function roundPrice(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  if (Math.abs(value) >= 1000) {
    return Number(value.toFixed(2));
  }

  if (Math.abs(value) >= 1) {
    return Number(value.toFixed(4));
  }

  return Number(value.toFixed(6));
}

export function formatTraderPrice(value: number | null | undefined): string {
  const rounded = roundPrice(value);
  if (rounded == null) {
    return "n/a";
  }

  if (Math.abs(rounded) >= 1000) {
    return rounded.toFixed(2);
  }

  if (Math.abs(rounded) >= 1) {
    return rounded.toFixed(4);
  }

  return rounded.toFixed(6);
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatKillzoneName(killzone: string): string {
  const map: Record<string, string> = {
    asian_range: "Asian Range",
    london_open: "London Open",
    new_york_open: "New York Open",
    london_close: "London Close",
    off_hours: "Off Hours",
  };
  return map[killzone] ?? titleCase(killzone.replaceAll("_", " "));
}

function labelSession(session: SessionLabel | null | undefined): string {
  if (session === "asia") return "Asia";
  if (session === "london") return "London";
  if (session === "new_york") return "New York";
  if (session === "overlap") return "Overlap";
  return "Off hours";
}

type TraderCardSMCAnalysis = NonNullable<TraderDashboardSignal["smcAnalysis"]>;

function selectDirectionalStructure<T extends { type: "bullish" | "bearish" }>(
  items: T[],
  direction: TraderDirection,
): T | null {
  if (items.length === 0) {
    return null;
  }

  const preferred = direction === "long"
    ? "bullish"
    : direction === "short"
      ? "bearish"
      : null;

  return items.find(item => !preferred || item.type === preferred) ?? items[0] ?? null;
}

function buildCardSmcAnalysis(
  snapshot: FeatureSnapshot | null,
  candidate: AllocationIntent | null,
  direction: TraderDirection,
): TraderCardSMCAnalysis | undefined {
  const smc = snapshot?.smcAnalysis;
  if (!smc) {
    return undefined;
  }

  const livePrice = resolveLivePrice(snapshot, candidate);
  const rescored = rescoreSMCAnalysis(smc, mapDirectionForReasoning(direction), livePrice);
  const nearestOrderBlock = selectDirectionalStructure(smc.orderBlocks, direction);
  const nearestFVG = selectDirectionalStructure(smc.fairValueGaps, direction);
  const nearestBreaker = selectDirectionalStructure(smc.breakerBlocks, direction);
  const recentLiquiditySweep = smc.recentSweeps[0] ?? null;

  return {
    nearestOrderBlock: nearestOrderBlock
      ? {
        type: nearestOrderBlock.type,
        high: nearestOrderBlock.high,
        low: nearestOrderBlock.low,
        strength: nearestOrderBlock.strength,
      }
      : null,
    nearestFVG: nearestFVG
      ? {
        type: nearestFVG.type,
        upper: nearestFVG.upper,
        lower: nearestFVG.lower,
        fillPercent: nearestFVG.fillPercent,
      }
      : null,
    nearestBreaker: nearestBreaker
      ? {
        type: nearestBreaker.type,
        high: nearestBreaker.high,
        low: nearestBreaker.low,
      }
      : null,
    recentLiquiditySweep: recentLiquiditySweep
      ? {
        side: recentLiquiditySweep.side,
        reversal: recentLiquiditySweep.reversal,
        reversalStrength: recentLiquiditySweep.reversalStrength,
      }
      : null,
    killzone: formatKillzoneName(smc.killzone.current),
    minutesToNextKillzone: smc.killzone.minutesUntilNextKillzone,
    nextKillzone: formatKillzoneName(smc.killzone.nextKillzone),
    asianRangeHigh: smc.killzone.asianRangeHigh,
    asianRangeLow: smc.killzone.asianRangeLow,
    inOTE: smc.ote?.currentPriceInOTE ?? false,
    oteLevels: smc.ote
      ? {
        fib62: smc.ote.fib_62,
        fib705: smc.ote.fib_705,
        fib79: smc.ote.fib_79,
      }
      : null,
    pdLocation: smc.pdArrays.currentLocation,
    pdPercent: smc.pdArrays.currentPricePercent,
    cotBias: smc.cot?.smartMoneyBias ?? "unavailable",
    cotStrength: smc.cot?.smartMoneyBiasStrength ?? "unavailable",
    cotDivergence: smc.cot?.divergence ?? false,
    smcScore: rescored.total,
    smcVerdict: rescored.verdict,
  };
}

function buildSignalReasoningSmcContext(smcAnalysis: TraderCardSMCAnalysis | undefined): SignalReasoningContext["smcContext"] {
  if (!smcAnalysis) {
    return undefined;
  }

  const orderBlock = smcAnalysis.nearestOrderBlock
    ? `${smcAnalysis.nearestOrderBlock.type} OB at ${formatTraderPrice(smcAnalysis.nearestOrderBlock.low)}-${formatTraderPrice(smcAnalysis.nearestOrderBlock.high)} (${smcAnalysis.nearestOrderBlock.strength})`
    : null;
  const fvg = smcAnalysis.nearestFVG
    ? `${smcAnalysis.nearestFVG.type} FVG ${formatTraderPrice(smcAnalysis.nearestFVG.lower)}-${formatTraderPrice(smcAnalysis.nearestFVG.upper)} (${smcAnalysis.nearestFVG.fillPercent}% filled)`
    : null;
  const recentSweep = smcAnalysis.recentLiquiditySweep
    ? `${smcAnalysis.recentLiquiditySweep.side === "sellside" ? "SSL" : "BSL"} swept${smcAnalysis.recentLiquiditySweep.reversal ? ` with ${smcAnalysis.recentLiquiditySweep.reversalStrength} reversal` : ""}`
    : null;

  return {
    orderBlock,
    fvg,
    killzone: smcAnalysis.killzone,
    pdLocation: smcAnalysis.pdLocation,
    inOTE: smcAnalysis.inOTE,
    cotBias: smcAnalysis.cotBias === "unavailable"
      ? "unavailable"
      : `${smcAnalysis.cotBias} (${smcAnalysis.cotStrength})`,
    smcVerdict: smcAnalysis.smcVerdict,
    recentSweep,
  };
}

function gradeFromScore(score: number): TraderSignalGrade {
  if (score >= 92) return "S+";
  if (score >= 84) return "S";
  if (score >= 75) return "A";
  if (score >= 66) return "B";
  if (score >= 56) return "C";
  if (score >= 46) return "D";
  return "F";
}

export function gradeMeetsMinimum(grade: TraderSignalGrade, minimum: TraderSignalGrade): boolean {
  return GRADE_STRENGTH[grade] >= GRADE_STRENGTH[minimum];
}

function humanizeReason(reason: string): string {
  const known: Record<string, string> = {
    NEWS_WINDOW: "Major news is too close.",
    NO_LIVE_DATA: "Live market data is not available yet.",
    SNAPSHOT_UNAVAILABLE: "A feature snapshot could not be built yet.",
    SYMBOL_QUARANTINED: "This pair is currently quarantined.",
    execution_intent_unavailable: "Execution intent was not formed for this idea.",
    LOW_RR: "Reward to risk is too thin.",
    OFF_SESSION: "The pair is outside the preferred session.",
    VOL_TOO_HIGH: "Volatility is running too hot.",
    VOL_TOO_LOW: "Volatility is soft.",
    CONFLICTING_REGIME: "Current regime conflicts with the setup.",
    TOO_CLOSE_TO_STRUCTURE: "Price is already too close to key structure.",
    DUPLICATE_SIGNAL: "A similar signal was already logged recently.",
    SYMBOL_NOT_ACTIVE: "This symbol is not active in the live universe.",
    SYMBOL_NOT_SUPPORTED: "This symbol is outside the focused FX scope.",
    ENTRY_STYLE_DISABLED: "This strategy style is disabled.",
    PAIR_CONFIDENCE_BELOW_MIN: "This pair has not cleared its quality floor.",
    PAIR_RR_BELOW_MIN: "This pair has not cleared its reward-to-risk floor.",
    PAIR_SESSION_NOT_ALLOWED: "This pair is outside its allowed session window.",
    PAIR_SIGNAL_LIMIT_REACHED: "This pair already hit its daily signal limit.",
    SL_TOO_TIGHT: "The stop is too tight for current conditions.",
    SL_TOO_WIDE: "The stop is too wide for current conditions.",
    SPREAD_ABNORMAL: "Spread is abnormally wide.",
    NO_DIRECTIONAL_CONSENSUS: "Directional bias is not clean enough.",
    NO_TRADEABILITY_EDGE: "The current move does not offer a clean edge.",
    MARKET_DATA_DEGRADED: "Market data quality is degraded.",
    SESSION_LOCK: "Session conditions are not tradeable right now.",
    NEWS_LOCK: "News lock is active.",
    SIGNAL_EXPIRED: "The setup timing has expired.",
    HIGHER_TIMEFRAME_CONFLICT: "Higher-timeframe structure is conflicting.",
  };

  if (known[reason]) {
    return known[reason];
  }

  return `${reason.toLowerCase().replaceAll("_", " ")}.`;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function latestBySymbol<T>(rows: T[], getSymbol: (row: T) => string, getTs: (row: T) => number): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const symbol = getSymbol(row);
    const current = latest.get(symbol);
    if (!current || getTs(row) >= getTs(current)) {
      latest.set(symbol, row);
    }
  }
  return latest;
}

function createUnavailableMarketDataDiagnostics(symbol: string, interval = "15min", reason = "snapshot_unavailable"): PairMarketDataDiagnostics {
  return {
    symbol,
    interval,
    provider: null,
    candlesFetched: 0,
    lastCandleTimestamp: null,
    latencyMs: 0,
    sourceMode: "unavailable",
    usedFallback: false,
    qualityFlag: null,
    unavailableReason: reason,
  };
}

function resolveLivePrice(snapshot: FeatureSnapshot | null, candidate: AllocationIntent | null): number | null {
  const livePrice = snapshot?.features.mid
    ?? snapshot?.features.ema_9
    ?? snapshot?.features.ema_21
    ?? candidate?.entry
    ?? null;
  return roundPrice(livePrice);
}

function resolveDirection(candidate: AllocationIntent | null): TraderDirection {
  if (candidate?.direction === "buy") return "long";
  if (candidate?.direction === "sell") return "short";
  return "neutral";
}

function resolveBias(snapshot: FeatureSnapshot | null, candidate: AllocationIntent | null): TraderBias {
  const structureBias = snapshot?.context.market_structure?.structureBias;
  if (structureBias === "bullish" || structureBias === "bearish") {
    return structureBias;
  }
  if (candidate?.direction === "buy") return "bullish";
  if (candidate?.direction === "sell") return "bearish";
  return "neutral";
}

function resolveStructure(snapshot: FeatureSnapshot | null, candidate: AllocationIntent | null): TraderStructureLabel {
  const structure = snapshot?.context.market_structure;
  if (!structure) {
    return "neutral";
  }
  if (structure.changeOfCharacter !== "none") {
    return "CHOCH";
  }
  if (structure.breakOfStructure !== "none") {
    return "BOS";
  }
  if (candidate?.regime === "range" || structure.structureBias === "neutral") {
    return "range";
  }
  return "trend continuation";
}

function resolveLocation(snapshot: FeatureSnapshot | null, livePrice: number | null): TraderLocation {
  if (!snapshot || livePrice == null) {
    return "neutral";
  }
  const structure = snapshot.context.market_structure;
  const recentHigh = structure?.recentSwingHigh ?? structure?.previousSwingHigh ?? null;
  const recentLow = structure?.recentSwingLow ?? structure?.previousSwingLow ?? null;
  if (recentHigh == null || recentLow == null || recentHigh <= recentLow) {
    return "neutral";
  }

  const midpoint = (recentHigh + recentLow) / 2;
  const atr = Math.max(snapshot.features.atr_14 ?? 0, livePrice * 0.0005);
  const tolerance = Math.max(atr * 0.12, Math.abs(recentHigh - recentLow) * 0.05);

  if (Math.abs(livePrice - midpoint) <= tolerance) {
    return "equilibrium";
  }

  return livePrice > midpoint ? "premium" : "discount";
}

function resolveLiquidityState(snapshot: FeatureSnapshot | null): TraderLiquidityState {
  if (!snapshot) {
    return "neutral";
  }
  const structure = snapshot.context.market_structure;
  if (!structure) {
    return "neutral";
  }

  const livePrice = snapshot.features.mid ?? snapshot.features.ema_9 ?? snapshot.features.ema_21 ?? 0;
  const atr = Math.max(snapshot.features.atr_14 ?? 0, livePrice * 0.0005);
  const nearHighLiquidity = structure.distanceToSessionHigh <= atr * 0.3 || structure.distanceToPreviousDayHigh <= atr * 0.3;
  const nearLowLiquidity = structure.distanceToSessionLow <= atr * 0.3 || structure.distanceToPreviousDayLow <= atr * 0.3;

  if (structure.changeOfCharacter === "bearish" && nearHighLiquidity) {
    return "liquidity sweep";
  }
  if (structure.changeOfCharacter === "bullish" && nearLowLiquidity) {
    return "liquidity sweep";
  }
  return "no sweep";
}

function resolveZoneType(candidate: AllocationIntent | null): TraderZoneType {
  if (!candidate?.trade_plan?.entry_zone) {
    return "neutral";
  }
  if (candidate.direction === "buy") return "demand";
  if (candidate.direction === "sell") return "supply";
  return "POI";
}

function resolveMarketPhase(
  snapshot: FeatureSnapshot | null,
  candidate: AllocationIntent | null,
  bias: TraderBias,
  structure: TraderStructureLabel,
): TraderMarketPhase {
  const sessionFeatures = snapshot?.context.session_features;
  if (sessionFeatures?.sessionCompressionState === "compressed") {
    if (bias === "bearish") return "distribution";
    if (bias === "bullish") return "accumulation";
  }

  if (structure === "BOS" || sessionFeatures?.sessionBreakoutState !== "none") {
    return "expansion";
  }

  if (candidate?.entry_style === "session_breakout" && candidate.direction !== "none") {
    return "expansion";
  }

  if (candidate?.entry_style === "range_reversal" && candidate.direction === "buy") {
    return "accumulation";
  }

  if (candidate?.entry_style === "range_reversal" && candidate.direction === "sell") {
    return "distribution";
  }

  if (candidate?.entry_style === "trend_pullback" && candidate.direction !== "none") {
    return "pullback";
  }

  return "neutral";
}

function resolveSetupType(
  snapshot: FeatureSnapshot | null,
  candidate: AllocationIntent | null,
  direction: TraderDirection,
  structure: TraderStructureLabel,
  liquidityState: TraderLiquidityState,
): TraderSetupType {
  if (candidate?.entry_style === "session_breakout" && direction !== "neutral") {
    return "session breakout";
  }
  if (candidate?.entry_style === "range_reversal" && direction !== "neutral") {
    return "range reversal";
  }
  const sessionBreakoutState = snapshot?.context.session_features?.sessionBreakoutState;
  if (liquidityState === "liquidity sweep" && structure === "CHOCH") {
    return "liquidity sweep reversal";
  }
  if (structure === "BOS") {
    return "continuation after BOS";
  }
  if (
    direction === "long" && sessionBreakoutState === "bullish"
    || direction === "short" && sessionBreakoutState === "bearish"
  ) {
    return "session continuation";
  }
  return "trend pullback";
}

function describeZone(zone: PriceZone | null | undefined, zoneType: TraderZoneType): string | null {
  if (!zone) {
    return null;
  }

  const zoneLabel = zoneType === "neutral" ? zone.label : titleCase(zoneType);
  return `${zoneLabel} ${formatTraderPrice(zone.low)}-${formatTraderPrice(zone.high)}`;
}

function resolveKeyLevels(
  snapshot: FeatureSnapshot | null,
  livePrice: number | null,
  location: TraderLocation,
  activeZone: string | null,
): TraderKeyLevels {
  const structure = snapshot?.context.market_structure;
  if (!structure || livePrice == null) {
    return {
      previousDayHigh: null,
      previousDayLow: null,
      sessionHigh: null,
      sessionLow: null,
      location,
      activeZone,
    };
  }

  return {
    previousDayHigh: roundPrice(livePrice + structure.distanceToPreviousDayHigh),
    previousDayLow: roundPrice(livePrice - structure.distanceToPreviousDayLow),
    sessionHigh: roundPrice(livePrice + structure.distanceToSessionHigh),
    sessionLow: roundPrice(livePrice - structure.distanceToSessionLow),
    location,
    activeZone,
  };
}

function countWarnings(riskDecision: RiskDecision | null): number {
  return riskDecision?.warning_reasons?.length ?? 0;
}

function isRiskBlocked(candidate: AllocationIntent | null, riskDecision: RiskDecision | null): boolean {
  if (!candidate || candidate.direction === "none" || !riskDecision) {
    return false;
  }

  return riskDecision.approval_status === "rejected"
    || riskDecision.approval_status === "deferred"
    || riskDecision.kill_switch_active
    || riskDecision.de_risking_action === "halt_symbol"
    || riskDecision.de_risking_action === "halt_pod"
    || riskDecision.de_risking_action === "kill_switch";
}

function resolveBlockedReasons(candidate: AllocationIntent | null, riskDecision: RiskDecision | null): string[] {
  return dedupeStrings([
    ...(candidate?.veto_reasons?.map(humanizeReason) ?? []),
    ...(riskDecision?.veto_reasons?.map(humanizeReason) ?? []),
    ...(riskDecision?.warning_reasons?.map(humanizeReason) ?? []),
  ]);
}

function resolveNoTradeReason(input: {
  snapshot: FeatureSnapshot | null;
  candidate: AllocationIntent | null;
  riskDecision: RiskDecision | null;
  status: TraderSignalStatus;
  structure: TraderStructureLabel;
}): TraderNoTradeReason | null {
  if (!input.snapshot) {
    return "data unavailable";
  }
  if (input.status === "active") {
    return null;
  }
  if (input.status === "blocked" || isRiskBlocked(input.candidate, input.riskDecision)) {
    return "blocked by risk";
  }

  const session = input.candidate?.session ?? input.snapshot.context.session.session;
  if (session === "off_hours") {
    return "off session";
  }

  const tradeability = input.snapshot.context.tradeability;
  const lowVolatility = tradeability?.volatilityState === "too_low"
    || tradeability?.pairVolatilityRegime === "low"
    || input.snapshot.context.session_features?.sessionCompressionState === "compressed";
  if (lowVolatility) {
    return "low volatility";
  }

  if (input.structure === "neutral" || input.structure === "range") {
    return "no structure";
  }

  return "awaiting setup";
}

function buildWhyNotValid(input: {
  noTradeReason: TraderNoTradeReason | null;
  blockedReasons: string[];
  grade: TraderSignalGrade | null;
  candidate: AllocationIntent | null;
}): string | null {
  if (input.noTradeReason == null) {
    return null;
  }
  if (input.noTradeReason === "blocked by risk") {
    return input.blockedReasons[0] ?? "Risk controls are not approving the setup yet.";
  }
  if (input.noTradeReason === "off session") {
    return "The pair is outside the active trading session for this setup.";
  }
  if (input.noTradeReason === "low volatility") {
    return input.blockedReasons[0] ?? "Volatility is too soft to support a clean intraday setup.";
  }
  if (input.noTradeReason === "no structure") {
    return input.blockedReasons[0] ?? "Structure has not produced a clean directional read yet.";
  }
  if (input.noTradeReason === "data unavailable") {
    return "A live market snapshot is not available yet.";
  }
  if (!input.candidate) {
    return "The market is being analysed, but no directional setup has formed yet.";
  }
  if (input.grade && !gradeMeetsMinimum(input.grade, "B")) {
    return `The setup is developing but still below the B-grade signal floor.`;
  }
  return "The market is being analysed while the setup continues to develop.";
}

function resolveMarketStateLabels(input: {
  snapshot: FeatureSnapshot | null;
  marketPhase: TraderMarketPhase;
}): TraderMarketStateLabel[] {
  const labels: TraderMarketStateLabel[] = [];
  const session = input.snapshot?.context.session.session ?? null;
  const tradeability = input.snapshot?.context.tradeability;
  const sessionFeatures = input.snapshot?.context.session_features;

  const push = (label: TraderMarketStateLabel) => {
    if (!labels.includes(label)) {
      labels.push(label);
    }
  };

  if (session === "london" || session === "new_york" || session === "overlap") {
    push("active session");
  }
  if (session === "asia" || session === "off_hours") {
    push("low liquidity");
  }
  if (
    tradeability?.volatilityState === "too_low"
    || tradeability?.pairVolatilityRegime === "low"
    || sessionFeatures?.sessionCompressionState === "compressed"
  ) {
    push("dead market");
  }
  if (input.marketPhase === "expansion" || sessionFeatures?.sessionBreakoutState !== "none") {
    push("expansion");
  }
  if (input.marketPhase === "pullback") {
    push("pullback");
  }

  return labels;
}

function structureAlignsWithDirection(direction: TraderDirection, bias: TraderBias): boolean {
  return direction === "long" && bias === "bullish" || direction === "short" && bias === "bearish";
}

function locationAlignsWithDirection(direction: TraderDirection, location: TraderLocation): boolean {
  return direction === "long" && location === "discount" || direction === "short" && location === "premium";
}

function zoneAlignsWithDirection(direction: TraderDirection, zoneType: TraderZoneType): boolean {
  return direction === "long" && zoneType === "demand" || direction === "short" && zoneType === "supply";
}

function computeGrade(input: {
  candidate: AllocationIntent | null;
  snapshot: FeatureSnapshot | null;
  riskDecision: RiskDecision | null;
  direction: TraderDirection;
  bias: TraderBias;
  structure: TraderStructureLabel;
  location: TraderLocation;
  zoneType: TraderZoneType;
  config: Pick<ApexConfig, "pairProfiles">;
}): {
  grade: TraderSignalGrade;
  score: number;
  explanation: string;
} {
  if (!input.candidate) {
    return {
      grade: "F",
      score: 0,
      explanation: "No live candidate is available yet, so the market stays ungraded.",
    };
  }

  const pairProfile = input.config.pairProfiles[input.candidate.symbol_canonical as keyof typeof input.config.pairProfiles] ?? null;
  const confidenceScore = clamp01(input.candidate.confidence) * 60;
  const rr = input.candidate.trade_plan?.risk_reward_ratio ?? 0;
  const rrScore = Math.max(0, Math.min(12, (rr - 1.2) * 8));

  let structureScore = 0;
  if (structureAlignsWithDirection(input.direction, input.bias)) {
    structureScore += 10;
  }
  if (input.structure === "CHOCH" || input.structure === "BOS") {
    structureScore += 6;
  } else if (input.structure === "trend continuation") {
    structureScore += 4;
  } else if (input.structure === "range") {
    structureScore -= 4;
  }
  if (locationAlignsWithDirection(input.direction, input.location)) {
    structureScore += 4;
  }
  if (zoneAlignsWithDirection(input.direction, input.zoneType)) {
    structureScore += 4;
  }

  let sessionScore = 0;
  if (input.candidate.session === "off_hours") {
    sessionScore -= 10;
  } else {
    sessionScore += 4;
  }
  const preferredSessions = pairProfile?.preferredSessions ?? [];
  if (preferredSessions.includes(input.candidate.session as typeof preferredSessions[number])) {
    sessionScore += 4;
  }
  if (input.snapshot?.context.economic_event.majorNewsFlag) {
    sessionScore -= 8;
  }

  const freshnessScore = input.snapshot?.quality.staleness_ms != null && input.snapshot.quality.staleness_ms <= 15 * 60_000
    ? 4
    : 0;
  const vetoPenalty = ((input.candidate.veto_reasons?.length ?? 0) + (input.riskDecision?.veto_reasons?.length ?? 0)) * 7;
  const warningPenalty = countWarnings(input.riskDecision) * 3;
  const rejectionPenalty = input.riskDecision?.approval_status === "rejected" ? 18 : 0;
  const reducedPenalty = input.riskDecision?.approval_status === "approved_reduced" ? 6 : 0;
  const directionPenalty = input.direction === "neutral" ? 20 : 0;

  const score = Math.max(
    0,
    Math.min(
      100,
      confidenceScore
      + rrScore
      + structureScore
      + sessionScore
      + freshnessScore
      - vetoPenalty
      - warningPenalty
      - rejectionPenalty
      - reducedPenalty
      - directionPenalty,
    ),
  );
  const grade = gradeFromScore(score);
  const explanationParts = dedupeStrings([
    `${grade} grade from a ${Math.round(input.candidate.confidence * 100)}% engine-quality read.`,
    structureAlignsWithDirection(input.direction, input.bias)
      ? `Bias and direction are aligned on ${input.structure}.`
      : input.structure === "range"
        ? "Structure is still range-like."
        : "Structure alignment is only partial.",
    rr > 0 ? `The plan projects roughly ${rr.toFixed(2)}R to TP1.` : "Reward to risk is not well defined.",
    input.riskDecision?.approval_status === "rejected"
      ? "Hard vetoes are active, which drags the grade down."
      : input.riskDecision?.approval_status === "approved_reduced"
        ? "Warnings are active, so the setup is downgraded."
        : "No hard block is active.",
  ]);

  return {
    grade,
    score,
    explanation: explanationParts.join(" "),
  };
}

export function assessTraderSignalGrade(input: {
  candidate: AllocationIntent | null;
  snapshot: FeatureSnapshot | null;
  riskDecision: RiskDecision | null;
  direction: TraderDirection;
  bias: TraderBias;
  structure: TraderStructureLabel;
  location: TraderLocation;
  zoneType: TraderZoneType;
  config: Pick<ApexConfig, "pairProfiles">;
}) {
  return computeGrade(input);
}

function resolveStatus(input: {
  candidate: AllocationIntent | null;
  riskDecision: RiskDecision | null;
  lifecycle: SignalLifecycleRecord | null;
  grade: TraderSignalGrade;
}): TraderSignalStatus {
  const state = input.lifecycle?.state ?? null;
  if (state === "expired") {
    return "expired";
  }
  if (state === "stopped_out" || state === "cancelled") {
    return "invalidated";
  }
  if (!input.candidate || input.candidate.direction === "none") {
    return "watchlist";
  }
  if (isRiskBlocked(input.candidate, input.riskDecision)) {
    return "blocked";
  }
  if (gradeMeetsMinimum(input.grade, "B")) {
    return "active";
  }
  return "watchlist";
}

function buildKeyLevelsSummary(levels: TraderKeyLevels): string {
  const parts = [
    `PDH ${formatTraderPrice(levels.previousDayHigh)}`,
    `PDL ${formatTraderPrice(levels.previousDayLow)}`,
    `Session H ${formatTraderPrice(levels.sessionHigh)}`,
    `Session L ${formatTraderPrice(levels.sessionLow)}`,
    `Location ${levels.location}`,
    levels.activeZone ? `Zone ${levels.activeZone}` : null,
  ];
  return dedupeStrings(parts).join(" • ");
}

function buildMarketStructureSummary(input: {
  bias: TraderBias;
  structure: TraderStructureLabel;
  location: TraderLocation;
  zoneType: TraderZoneType;
  marketPhase: TraderMarketPhase;
}): string {
  const segments = [
    `${titleCase(input.bias)} bias`,
    input.structure === "neutral" ? "structure is neutral" : `structure reads as ${input.structure}`,
    input.location === "neutral" ? null : `price is in ${input.location}`,
    input.zoneType === "neutral" ? null : `active zone looks like ${input.zoneType}`,
    input.marketPhase === "neutral" ? null : `market phase is ${input.marketPhase}`,
  ];
  return dedupeStrings(segments).join(", ");
}

function buildLiquiditySummary(liquidityState: TraderLiquidityState, snapshot: FeatureSnapshot | null): string {
  if (liquidityState === "liquidity sweep") {
    return "Current structure suggests a liquidity sweep at a nearby session or previous-day extreme.";
  }
  if (!snapshot?.context.market_structure) {
    return "Liquidity read stays neutral because structure context is incomplete.";
  }
  return "No clear liquidity sweep is currently derived from session or previous-day extremes.";
}

function buildShortReasoning(input: {
  direction: TraderDirection;
  bias: TraderBias;
  setupType: TraderSetupType;
  structure: TraderStructureLabel;
  location: TraderLocation;
  zoneType: TraderZoneType;
  session: string;
  status: TraderSignalStatus;
  whyNotValid: string | null;
}): string {
  if (input.direction === "neutral") {
    return input.whyNotValid
      ? `${titleCase(input.bias)} conditions are under analysis: ${input.whyNotValid}`
      : `${titleCase(input.bias)} conditions are under analysis with no trade confirmed yet.`;
  }
  if (input.status === "blocked") {
    return input.whyNotValid
      ? `${titleCase(input.bias)} bias, but the idea is blocked: ${input.whyNotValid}`
      : "The market is not tradeable right now.";
  }

  const directionLabel = input.direction === "long" ? "long" : "short";
  const contextParts = dedupeStrings([
    input.structure === "neutral" ? null : input.structure,
    input.location === "neutral" ? null : input.location,
    input.zoneType === "neutral" ? null : input.zoneType,
  ]);
  const contextSuffix = contextParts.length > 0 ? ` with ${contextParts.join(", ")}` : "";
  if (input.status === "watchlist") {
    return input.whyNotValid
      ? `${titleCase(input.bias)} ${directionLabel} ${input.setupType} is developing in ${input.session}${contextSuffix}. ${input.whyNotValid}`
      : `${titleCase(input.bias)} ${directionLabel} ${input.setupType} is developing in ${input.session}${contextSuffix}.`;
  }
  return `${titleCase(input.bias)} ${directionLabel} ${input.setupType} in ${input.session}${contextSuffix}.`;
}

function buildDetailedReasoning(input: {
  candidate: AllocationIntent | null;
  direction: TraderDirection;
  bias: TraderBias;
  session: string;
  setupType: TraderSetupType;
  structure: TraderStructureLabel;
  location: TraderLocation;
  zoneType: TraderZoneType;
  marketPhase: TraderMarketPhase;
  activeZone: string | null;
  gradeExplanation: string;
  whyNotValid: string | null;
}): TraderDetailedReasoning {
  const tradePlan = input.candidate?.trade_plan ?? null;
  return {
    whyThisIsASetup: input.direction === "neutral"
      ? "The engine is analysing market structure here, but there is not enough directional agreement for an active setup yet."
      : `${titleCase(input.bias)} ${input.setupType} is supported by ${input.structure} structure with ${input.location} location${input.zoneType === "neutral" ? "" : ` and a ${input.zoneType} zone`}.`,
    whyNow: `${input.session} is the active session and the market phase reads as ${input.marketPhase === "neutral" ? "balanced" : input.marketPhase}.`,
    whyThisLevel: tradePlan?.entry_zone
      ? `The level is built around ${input.activeZone ?? tradePlan.entry_zone.label}, with the entry leaning into the current pullback instead of chasing extension.`
      : "No clean execution zone is available yet, so the market stays closer to watchlist language.",
    whatWouldInvalidateIt: tradePlan
      ? `${tradePlan.pre_entry_invalidation} ${tradePlan.post_entry_invalidation}`
      : "A cleaner opposing structure shift or a loss of tradeability would invalidate the read.",
    whyItGotItsGrade: input.whyNotValid
      ? `${input.gradeExplanation} The setup is not valid yet because ${input.whyNotValid.toLowerCase()}`
      : input.gradeExplanation,
  };
}

function createCard(input: {
  symbol: string;
  snapshot: FeatureSnapshot | null;
  candidate: AllocationIntent;
  riskDecision: RiskDecision | null;
  lifecycle: SignalLifecycleRecord | null;
  config: Pick<ApexConfig, "pairProfiles">;
}): TraderDashboardSignal {
  const livePrice = resolveLivePrice(input.snapshot, input.candidate);
  const direction = resolveDirection(input.candidate);
  const bias = resolveBias(input.snapshot, input.candidate);
  const structure = resolveStructure(input.snapshot, input.candidate);
  const location = resolveLocation(input.snapshot, livePrice);
  const liquidityState = resolveLiquidityState(input.snapshot);
  const zoneType = resolveZoneType(input.candidate);
  const marketPhase = resolveMarketPhase(input.snapshot, input.candidate, bias, structure);
  const setupType = resolveSetupType(input.snapshot, input.candidate, direction, structure, liquidityState);
  const activeZone = describeZone(input.candidate.trade_plan?.entry_zone, zoneType);
  const keyLevels = resolveKeyLevels(input.snapshot, livePrice, location, activeZone);
  const blockedReasons = resolveBlockedReasons(input.candidate, input.riskDecision);
  const { grade, explanation } = computeGrade({
    candidate: input.candidate,
    snapshot: input.snapshot,
    riskDecision: input.riskDecision,
    direction,
    bias,
    structure,
    location,
    zoneType,
    config: input.config,
  });
  const status = resolveStatus({
    candidate: input.candidate,
    riskDecision: input.riskDecision,
    lifecycle: input.lifecycle,
    grade,
  });
  const noTradeReason = resolveNoTradeReason({
    snapshot: input.snapshot,
    candidate: input.candidate,
    riskDecision: input.riskDecision,
    status,
    structure,
  });
  const whyNotValid = buildWhyNotValid({
    noTradeReason,
    blockedReasons,
    grade,
    candidate: input.candidate,
  });
  const marketStateLabels = resolveMarketStateLabels({
    snapshot: input.snapshot,
    marketPhase,
  });

  return {
    symbol: input.symbol,
    livePrice,
    direction,
    grade,
    setupType,
    session: labelSession(input.candidate.session),
    bias,
    structure,
    liquidityState,
    location,
    zoneType,
    marketPhase,
    entry: roundPrice(input.candidate.trade_plan?.entry ?? input.candidate.entry),
    sl: roundPrice(input.candidate.trade_plan?.sl ?? input.candidate.sl),
    tp1: roundPrice(input.candidate.trade_plan?.tp1 ?? input.candidate.tp1),
    tp2: roundPrice(input.candidate.trade_plan?.tp2 ?? input.candidate.tp2),
    tp3: roundPrice(input.candidate.trade_plan?.tp3 ?? input.candidate.tp3),
    shortReasoning: buildShortReasoning({
      direction,
      bias,
      setupType,
      structure,
      location,
      zoneType,
      session: labelSession(input.candidate.session),
      status,
      whyNotValid,
    }),
    detailedReasoning: buildDetailedReasoning({
      candidate: input.candidate,
      direction,
      bias,
      session: labelSession(input.candidate.session),
      setupType,
      structure,
      location,
      zoneType,
      marketPhase,
      activeZone,
      gradeExplanation: explanation,
      whyNotValid,
    }),
    marketStructureSummary: buildMarketStructureSummary({
      bias,
      structure,
      location,
      zoneType,
      marketPhase,
    }),
    liquiditySummary: buildLiquiditySummary(liquidityState, input.snapshot),
    keyLevelsSummary: buildKeyLevelsSummary(keyLevels),
    keyLevels,
    noTradeReason,
    whyNotValid,
    marketStateLabels,
    status,
    blockedReasons,
    latestLifecycle: input.lifecycle,
    lifecycleState: input.lifecycle?.state ?? null,
    confidence: input.candidate.confidence,
    podVoteSummary: input.candidate.pod_vote_summary,
    smcAnalysis: buildCardSmcAnalysis(input.snapshot, input.candidate, direction),
  };
}

type TraderReasoningSource = {
  symbol: string;
  snapshot: FeatureSnapshot | null;
  candidate: AllocationIntent | null;
  riskDecision: RiskDecision | null;
  card?: TraderDashboardSignal | null;
  liveMarket?: TraderLiveMarketRow | null;
  marketReasoning?: TraderMarketReasoningRow | null;
  keyAreas?: TraderKeyAreasRow | null;
};

function mapDirectionForReasoning(direction: TraderDirection): SignalReasoningContext["direction"] {
  if (direction === "long") {
    return "buy";
  }
  if (direction === "short") {
    return "sell";
  }
  return "neutral";
}

function resolveReasoningKeyLevels(input: TraderReasoningSource): TraderKeyLevels {
  if (input.card?.keyLevels) {
    return input.card.keyLevels;
  }
  if (input.keyAreas) {
    return {
      previousDayHigh: input.keyAreas.previousDayHigh,
      previousDayLow: input.keyAreas.previousDayLow,
      sessionHigh: input.keyAreas.sessionHigh,
      sessionLow: input.keyAreas.sessionLow,
      location: input.keyAreas.location,
      activeZone: input.keyAreas.activeZone,
    };
  }

  const livePrice = input.card?.livePrice
    ?? input.liveMarket?.livePrice
    ?? resolveLivePrice(input.snapshot, input.candidate);
  return resolveKeyLevels(
    input.snapshot,
    livePrice,
    input.card?.location ?? resolveLocation(input.snapshot, livePrice),
    null,
  );
}

function buildSignalReasoningContext(input: TraderReasoningSource): SignalReasoningContext {
  const card = input.card ?? null;
  const liveMarket = input.liveMarket ?? null;
  const livePrice = card?.livePrice ?? liveMarket?.livePrice ?? resolveLivePrice(input.snapshot, input.candidate);
  const direction = card?.direction ?? resolveDirection(input.candidate);
  const bias = card?.bias ?? liveMarket?.bias ?? resolveBias(input.snapshot, input.candidate);
  const structure = card?.structure ?? resolveStructure(input.snapshot, input.candidate);
  const location = card?.location ?? resolveLocation(input.snapshot, livePrice);
  const liquidityState = card?.liquidityState ?? resolveLiquidityState(input.snapshot);
  const zoneType = card?.zoneType ?? resolveZoneType(input.candidate);
  const marketPhase = card?.marketPhase ?? resolveMarketPhase(input.snapshot, input.candidate, bias, structure);
  const setupType = card?.setupType ?? resolveSetupType(input.snapshot, input.candidate, direction, structure, liquidityState);
  const status = card?.status ?? liveMarket?.status ?? "watchlist";
  const noTradeReason = card?.noTradeReason ?? liveMarket?.noTradeReason ?? resolveNoTradeReason({
    snapshot: input.snapshot,
    candidate: input.candidate,
    riskDecision: input.riskDecision,
    status,
    structure,
  });
  const blockedReasons = card?.blockedReasons ?? resolveBlockedReasons(input.candidate, input.riskDecision);
  const marketStateLabels = card?.marketStateLabels ?? liveMarket?.marketStateLabels ?? resolveMarketStateLabels({
    snapshot: input.snapshot,
    marketPhase,
  });
  const keyLevels = resolveReasoningKeyLevels(input);
  const smcAnalysis = card?.smcAnalysis ?? buildCardSmcAnalysis(input.snapshot, input.candidate, direction);

  return {
    symbol: input.symbol,
    direction: mapDirectionForReasoning(direction),
    grade: card?.grade ?? liveMarket?.grade ?? "F",
    setupType,
    session: card?.session
      ?? liveMarket?.session
      ?? labelSession(input.candidate?.session ?? input.snapshot?.context.session.session ?? null),
    bias,
    structure,
    liquidityState,
    location,
    zoneType,
    marketPhase,
    confidence: card?.confidence ?? input.candidate?.confidence ?? 0,
    entry: card?.entry ?? roundPrice(input.candidate?.trade_plan?.entry ?? input.candidate?.entry),
    sl: card?.sl ?? roundPrice(input.candidate?.trade_plan?.sl ?? input.candidate?.sl),
    tp1: card?.tp1 ?? roundPrice(input.candidate?.trade_plan?.tp1 ?? input.candidate?.tp1),
    tp2: card?.tp2 ?? roundPrice(input.candidate?.trade_plan?.tp2 ?? input.candidate?.tp2),
    livePrice,
    noTradeReason,
    blockedReasons,
    vetoes: dedupeStrings([
      ...(input.riskDecision?.veto_reasons ?? []).map(humanizeReason),
      ...(input.candidate?.veto_reasons ?? []).map(humanizeReason),
    ]),
    podVoteSummary: (card?.podVoteSummary ?? input.candidate?.pod_vote_summary ?? null) as Record<string, unknown> | null,
    marketStateLabels,
    keyLevels: {
      pdh: keyLevels.previousDayHigh,
      pdl: keyLevels.previousDayLow,
      sessionHigh: keyLevels.sessionHigh,
      sessionLow: keyLevels.sessionLow,
    },
    smcContext: buildSignalReasoningSmcContext(smcAnalysis),
  };
}

function applySignalReasoningToCard(card: TraderDashboardSignal, reasoning: SignalReasoningOutput): TraderDashboardSignal {
  card.shortReasoning = reasoning.shortReasoning;
  card.detailedReasoning = {
    whyThisIsASetup: reasoning.whyThisSetup,
    whyNow: reasoning.whyNow,
    whyThisLevel: reasoning.whyThisLevel,
    whatWouldInvalidateIt: reasoning.invalidation,
    whyItGotItsGrade: reasoning.whyThisGrade,
  };
  card.whyThisSetup = reasoning.whyThisSetup;
  card.whyNow = reasoning.whyNow;
  card.whyThisLevel = reasoning.whyThisLevel;
  card.invalidation = reasoning.invalidation;
  card.whyThisGrade = reasoning.whyThisGrade;
  card.noTradeExplanation = reasoning.noTradeExplanation;
  card.marketStructureSummary = reasoning.marketStructureSummary;
  card.liquiditySummary = reasoning.liquiditySummary;
  card.keyLevelsSummary = reasoning.keyLevelsSummary;
  return card;
}

function summarizeMarketReasoning(reasoning: SignalReasoningOutput): string {
  if (reasoning.noTradeExplanation) {
    return `${reasoning.noTradeExplanation} ${reasoning.marketStructureSummary}`.trim();
  }
  return reasoning.detailedReasoning;
}

export async function enrichTraderDashboardSignal(input: {
  card: TraderDashboardSignal;
  symbol: string;
  snapshot: FeatureSnapshot | null;
  candidate: AllocationIntent | null;
  riskDecision: RiskDecision | null;
}): Promise<TraderDashboardSignal> {
  const reasoning = await generateSignalReasoning(buildSignalReasoningContext({
    symbol: input.symbol,
    snapshot: input.snapshot,
    candidate: input.candidate,
    riskDecision: input.riskDecision,
    card: input.card,
  }));
  return applySignalReasoningToCard(input.card, reasoning);
}

export async function enrichTraderPairRuntimeState(input: {
  state: TraderPairRuntimeState;
  snapshot: FeatureSnapshot | null;
  candidate: AllocationIntent | null;
  riskDecision: RiskDecision | null;
}): Promise<TraderPairRuntimeState> {
  const reasoning = await generateSignalReasoning(buildSignalReasoningContext({
    symbol: input.state.symbol,
    snapshot: input.snapshot,
    candidate: input.candidate,
    riskDecision: input.riskDecision,
    card: input.state.card,
    liveMarket: input.state.liveMarket,
    marketReasoning: input.state.marketReasoning,
    keyAreas: input.state.keyAreas,
  }));

  if (input.state.card) {
    applySignalReasoningToCard(input.state.card, reasoning);
  }
  input.state.marketReasoning.summary = summarizeMarketReasoning(reasoning);
  return input.state;
}

export async function enrichTraderSignalsPayload(input: {
  payload: TraderSignalsPayload;
  sourcesBySymbol?: Map<string, {
    snapshot: FeatureSnapshot | null;
    candidate: AllocationIntent | null;
    riskDecision: RiskDecision | null;
  }>;
}): Promise<TraderSignalsPayload> {
  const cardsBySymbol = new Map(input.payload.cards.map(card => [card.symbol, card]));
  const liveRowsBySymbol = new Map(input.payload.liveMarketBoard.map(row => [row.symbol, row]));
  const marketReasoningBySymbol = new Map(input.payload.marketReasoning.map(row => [row.symbol, row]));
  const keyAreasBySymbol = new Map(input.payload.keyAreas.map(row => [row.symbol, row]));
  const symbols = new Set<string>([
    ...cardsBySymbol.keys(),
    ...liveRowsBySymbol.keys(),
    ...marketReasoningBySymbol.keys(),
    ...keyAreasBySymbol.keys(),
  ]);

  for (const symbol of symbols) {
    const source = input.sourcesBySymbol?.get(symbol);
    const card = cardsBySymbol.get(symbol) ?? null;
    const liveMarket = liveRowsBySymbol.get(symbol) ?? null;
    const marketReasoning = marketReasoningBySymbol.get(symbol) ?? null;
    const keyAreas = keyAreasBySymbol.get(symbol) ?? null;
    if (!liveMarket && !card && !marketReasoning) {
      continue;
    }

    const reasoning = await generateSignalReasoning(buildSignalReasoningContext({
      symbol,
      snapshot: source?.snapshot ?? null,
      candidate: source?.candidate ?? null,
      riskDecision: source?.riskDecision ?? null,
      card,
      liveMarket,
      marketReasoning,
      keyAreas,
    }));

    if (card) {
      applySignalReasoningToCard(card, reasoning);
    }
    if (marketReasoning) {
      marketReasoning.summary = summarizeMarketReasoning(reasoning);
    }
  }

  return input.payload;
}

function buildMarketReasoning(
  symbol: string,
  snapshot: FeatureSnapshot | null,
  candidate: AllocationIntent | null,
  riskDecision: RiskDecision | null,
  card: TraderDashboardSignal | null,
): TraderMarketReasoningRow {
  if (card) {
    return {
      symbol,
      summary: `${card.shortReasoning} ${card.marketStructureSummary}.`,
      grade: card.grade,
      noTradeReason: card.noTradeReason,
      marketStateLabels: card.marketStateLabels,
      status: card.status,
    };
  }

  const livePrice = resolveLivePrice(snapshot, null);
  const bias = resolveBias(snapshot, null);
  const structure = resolveStructure(snapshot, null);
  const marketPhase = resolveMarketPhase(snapshot, null, bias, structure);
  const noTradeReason = resolveNoTradeReason({
    snapshot,
    candidate,
    riskDecision,
    status: "watchlist",
    structure,
  });
  const whyNotValid = buildWhyNotValid({
    noTradeReason,
    blockedReasons: resolveBlockedReasons(candidate, riskDecision),
    grade: null,
    candidate,
  });
  const marketStateLabels = resolveMarketStateLabels({
    snapshot,
    marketPhase,
  });
  const session = labelSession(snapshot?.context.session.session);
  const summary = livePrice == null
    ? "No live snapshot is available yet."
    : whyNotValid
      ? `${titleCase(bias)} conditions in ${session}; current structure reads as ${structure}. No signal yet: ${whyNotValid}`
      : `${titleCase(bias)} conditions in ${session}; current structure reads as ${structure}.`;
  return {
    symbol,
    summary,
    grade: null,
    noTradeReason,
    marketStateLabels,
    status: "watchlist",
  };
}

function buildLiveMarketRow(
  symbol: string,
  snapshot: FeatureSnapshot | null,
  candidate: AllocationIntent | null,
  riskDecision: RiskDecision | null,
  card: TraderDashboardSignal | null,
): TraderLiveMarketRow {
  const bias = card?.bias ?? resolveBias(snapshot, null);
  const structure = card?.structure ?? resolveStructure(snapshot, candidate);
  const marketPhase = card?.marketPhase ?? resolveMarketPhase(snapshot, candidate, bias, structure);
  const noTradeReason = card?.noTradeReason ?? resolveNoTradeReason({
    snapshot,
    candidate,
    riskDecision,
    status: card?.status ?? "watchlist",
    structure,
  });
  const marketStateLabels = card?.marketStateLabels ?? resolveMarketStateLabels({
    snapshot,
    marketPhase,
  });
  return {
    symbol,
    livePrice: card?.livePrice ?? resolveLivePrice(snapshot, null),
    session: labelSession(snapshot?.context.session.session ?? null),
    bias,
    grade: card?.grade ?? null,
    noTradeReason,
    marketStateLabels,
    status: card?.status ?? "watchlist",
  };
}

function buildSnapshotDiagnostics(input: {
  symbol: string;
  cycleId: string;
  generatedAt: number;
  marketData: PairMarketDataDiagnostics | null;
  snapshot: FeatureSnapshot | null;
  candidate: AllocationIntent | null;
  card: TraderDashboardSignal | null;
  riskDecision: RiskDecision | null;
  unavailableReason?: string | null;
}): TraderSnapshotDiagnostics {
  const blockedReasons = input.card?.blockedReasons ?? resolveBlockedReasons(input.candidate, input.riskDecision);
  const noTradeReason = blockedReasons[0]
    ?? (input.unavailableReason ? humanizeReason(input.unavailableReason) : null);
  return {
    symbol: input.symbol,
    cycleId: input.cycleId,
    generatedAt: input.generatedAt,
    marketData: input.marketData ?? createUnavailableMarketDataDiagnostics(input.symbol, "15min", input.unavailableReason ?? "snapshot_unavailable"),
    snapshotAvailable: input.snapshot != null,
    snapshotCreated: input.snapshot != null,
    snapshotTimestamp: input.snapshot?.ts ?? null,
    candidateCreated: input.candidate != null,
    traderCardCreated: input.card != null,
    cardStatus: input.card?.status ?? null,
    approvalStatus: input.riskDecision?.approval_status ?? null,
    noTradeReason,
    blockedReasons,
    unavailableReason: input.unavailableReason ?? null,
  };
}

export function buildTraderPairRuntimeState(input: {
  symbol: string;
  cycleId: string;
  generatedAt: number;
  snapshot: FeatureSnapshot | null;
  candidate: AllocationIntent | null;
  riskDecision: RiskDecision | null;
  lifecycle: SignalLifecycleRecord | null;
  marketData: PairMarketDataDiagnostics | null;
  config: Pick<ApexConfig, "pairProfiles">;
  unavailableReason?: string | null;
}): TraderPairRuntimeState {
  const card = input.snapshot && input.candidate
    ? createCard({
      symbol: input.symbol,
      snapshot: input.snapshot,
      candidate: input.candidate,
      riskDecision: input.riskDecision,
      lifecycle: input.lifecycle,
      config: input.config,
    })
    : null;
  const liveMarket = buildLiveMarketRow(input.symbol, input.snapshot, input.candidate, input.riskDecision, card);
  const marketReasoning = buildMarketReasoning(input.symbol, input.snapshot, input.candidate, input.riskDecision, card);
  const keyAreas = card?.keyLevels ?? resolveKeyLevels(
    input.snapshot,
    resolveLivePrice(input.snapshot, input.candidate),
    resolveLocation(input.snapshot, resolveLivePrice(input.snapshot, input.candidate)),
    null,
  );

  return {
    symbol: input.symbol,
    cycleId: input.cycleId,
    generatedAt: input.generatedAt,
    snapshotAvailable: input.snapshot != null,
    liveMarket,
    marketReasoning,
    keyAreas: {
      symbol: input.symbol,
      ...keyAreas,
    },
    card,
    diagnostics: buildSnapshotDiagnostics({
      symbol: input.symbol,
      cycleId: input.cycleId,
      generatedAt: input.generatedAt,
      marketData: input.marketData,
      snapshot: input.snapshot,
      candidate: input.candidate,
      card,
      riskDecision: input.riskDecision,
      unavailableReason: input.unavailableReason ?? (input.snapshot ? null : "snapshot_unavailable"),
    }),
  };
}

export function buildTraderDashboardSignal(input: {
  symbol: string;
  snapshot: FeatureSnapshot | null;
  candidate: AllocationIntent;
  riskDecision: RiskDecision | null;
  lifecycle: SignalLifecycleRecord | null;
  config: Pick<ApexConfig, "pairProfiles">;
}): TraderDashboardSignal {
  return createCard(input);
}

export function buildTraderSignalsPayload(input: {
  activeSymbols: string[];
  candidates: AllocationIntent[];
  snapshots: FeatureSnapshot[];
  riskDecisions: RiskDecision[];
  lifecycles: SignalLifecycleRecord[];
  preferences: TraderOperatorPreferences;
  config: Pick<ApexConfig, "pairProfiles">;
}): TraderSignalsPayload {
  const payloadGeneratedAt = Date.now();
  const latestCandidates = latestBySymbol(input.candidates, candidate => candidate.symbol_canonical, candidate => candidate.ts);
  const latestSnapshots = latestBySymbol(input.snapshots, snapshot => snapshot.symbol_canonical, snapshot => snapshot.ts);
  const latestRiskDecisions = latestBySymbol(input.riskDecisions, decision => decision.scope, decision => decision.ts);
  const latestLifecycles = latestBySymbol(input.lifecycles, lifecycle => lifecycle.signal_id, lifecycle => lifecycle.updated_ts);

  const cards: TraderDashboardSignal[] = [];
  const marketReasoning: TraderMarketReasoningRow[] = [];
  const liveMarketBoard: TraderLiveMarketRow[] = [];
  const keyAreas: TraderKeyAreasRow[] = [];
  const diagnostics: TraderSnapshotDiagnostics[] = [];

  for (const symbol of input.activeSymbols) {
    const snapshot = latestSnapshots.get(symbol) ?? null;
    const candidate = latestCandidates.get(symbol) ?? null;
    const riskDecision = latestRiskDecisions.get(symbol) ?? null;
    const lifecycle = candidate ? latestLifecycles.get(candidate.candidate_id) ?? null : null;
    const card = candidate
      ? createCard({
        symbol,
        snapshot,
        candidate,
        riskDecision,
        lifecycle,
        config: input.config,
      })
      : null;

    if (card) {
      cards.push(card);
    }

    marketReasoning.push(buildMarketReasoning(symbol, snapshot, candidate, riskDecision, card));
    liveMarketBoard.push(buildLiveMarketRow(symbol, snapshot, candidate, riskDecision, card));

    const derivedKeyLevels = card?.keyLevels ?? resolveKeyLevels(
      snapshot,
      resolveLivePrice(snapshot, candidate),
      resolveLocation(snapshot, resolveLivePrice(snapshot, candidate)),
      null,
    );
    keyAreas.push({
      symbol,
      ...derivedKeyLevels,
    });
    diagnostics.push(buildSnapshotDiagnostics({
      symbol,
      cycleId: `runtime_${symbol}`,
      generatedAt: payloadGeneratedAt,
      marketData: snapshot
        ? {
          symbol,
          interval: "15min",
          provider: snapshot.context.source,
          candlesFetched: 0,
          lastCandleTimestamp: snapshot.ts,
          latencyMs: 0,
          sourceMode: snapshot.context.source === "synthetic" ? "synthetic" : "live",
          usedFallback: false,
          qualityFlag: snapshot.context.quality_flag,
          unavailableReason: null,
        }
        : createUnavailableMarketDataDiagnostics(symbol),
      snapshot,
      candidate,
      card,
      riskDecision,
      unavailableReason: snapshot ? null : "snapshot_unavailable",
    }));
  }

  cards.sort((left, right) =>
    GRADE_STRENGTH[right.grade] - GRADE_STRENGTH[left.grade]
    || right.confidence - left.confidence
    || left.symbol.localeCompare(right.symbol),
  );

  return {
    generatedAt: payloadGeneratedAt,
    cards,
    liveMarketBoard,
    activeSignals: cards.filter(card => gradeMeetsMinimum(card.grade, "B") && card.status === "active"),
    developingSetups: cards.filter(card => card.status === "watchlist"),
    blockedSignals: cards.filter(card => card.status === "blocked" || card.status === "invalidated" || card.status === "expired"),
    watchlistSignals: cards.filter(card => card.status === "watchlist"),
    marketReasoning,
    keyAreas,
    diagnostics,
    preferences: input.preferences,
    marketCommentary: null,
  };
}

export function buildTraderSignalsPayloadFromStates(input: {
  activeSymbols: string[];
  states: TraderPairRuntimeState[];
  preferences: TraderOperatorPreferences;
}): TraderSignalsPayload {
  const stateBySymbol = new Map(input.states.map(state => [state.symbol, state]));
  const cards: TraderDashboardSignal[] = [];
  const liveMarketBoard: TraderLiveMarketRow[] = [];
  const marketReasoning: TraderMarketReasoningRow[] = [];
  const keyAreas: TraderKeyAreasRow[] = [];
  const diagnostics: TraderSnapshotDiagnostics[] = [];
  let generatedAt = 0;

  for (const symbol of input.activeSymbols) {
    const state = stateBySymbol.get(symbol);
    if (state) {
      generatedAt = Math.max(generatedAt, state.generatedAt);
      if (state.card) {
        cards.push(state.card);
      }
      liveMarketBoard.push(state.liveMarket);
      marketReasoning.push(state.marketReasoning);
      keyAreas.push(state.keyAreas);
      diagnostics.push(state.diagnostics);
      continue;
    }

    liveMarketBoard.push({
      symbol,
      livePrice: null,
      session: "Unavailable",
      bias: "neutral",
      grade: null,
      noTradeReason: "data unavailable",
      marketStateLabels: [],
      status: "blocked",
    });
    marketReasoning.push({
      symbol,
      summary: "No live snapshot is available yet.",
      grade: null,
      noTradeReason: "data unavailable",
      marketStateLabels: [],
      status: "blocked",
    });
    keyAreas.push({
      symbol,
      previousDayHigh: null,
      previousDayLow: null,
      sessionHigh: null,
      sessionLow: null,
      location: "neutral",
      activeZone: null,
    });
    diagnostics.push({
      symbol,
      cycleId: `missing_${symbol}`,
      generatedAt: 0,
      marketData: createUnavailableMarketDataDiagnostics(symbol),
      snapshotAvailable: false,
      snapshotCreated: false,
      snapshotTimestamp: null,
      candidateCreated: false,
      traderCardCreated: false,
      cardStatus: null,
      approvalStatus: null,
      noTradeReason: null,
      blockedReasons: [],
      unavailableReason: "snapshot_unavailable",
    });
  }

  cards.sort((left, right) =>
    GRADE_STRENGTH[right.grade] - GRADE_STRENGTH[left.grade]
    || right.confidence - left.confidence
    || left.symbol.localeCompare(right.symbol),
  );

  return {
    generatedAt,
    cards,
    liveMarketBoard,
    activeSignals: cards.filter(card => gradeMeetsMinimum(card.grade, "B") && card.status === "active"),
    developingSetups: cards.filter(card => card.status === "watchlist"),
    blockedSignals: cards.filter(card => card.status === "blocked" || card.status === "invalidated" || card.status === "expired"),
    watchlistSignals: cards.filter(card => card.status === "watchlist"),
    marketReasoning,
    keyAreas,
    diagnostics,
    preferences: input.preferences,
    marketCommentary: null,
  };
}

export function applyTraderLivePrices(
  payload: TraderSignalsPayload,
  livePrices: TraderLivePriceMap,
): TraderSignalsPayload {
  const cards = payload.cards.map(card => ({
    ...card,
    livePrice: livePrices[card.symbol] ?? null,
  }));

  return {
    ...payload,
    cards,
    activeSignals: cards.filter(card => gradeMeetsMinimum(card.grade, "B") && card.status === "active"),
    developingSetups: cards.filter(card => card.status === "watchlist"),
    blockedSignals: cards.filter(card => card.status === "blocked" || card.status === "invalidated" || card.status === "expired"),
    watchlistSignals: cards.filter(card => card.status === "watchlist"),
    liveMarketBoard: payload.liveMarketBoard.map(row => ({
      ...row,
      livePrice: livePrices[row.symbol] ?? null,
    })),
  };
}

export function buildTelegramReasons(card: TraderDashboardSignal): string[] {
  const reasons = dedupeStrings([
    `${titleCase(card.bias)} bias with ${card.structure}.`,
    card.location === "neutral" ? null : `Price sits in ${card.location}.`,
    card.zoneType === "neutral" ? null : `${titleCase(card.zoneType)} zone is active.`,
    card.marketPhase === "neutral" ? null : `${titleCase(card.marketPhase)} phase is in play.`,
    card.liquidityState === "liquidity sweep"
      ? "A sweep-and-reversal read is on the board."
      : "No active hard block is dominating the setup.",
  ]);

  return reasons.slice(0, 5);
}

export function shouldSendTraderTelegramSignal(
  card: TraderDashboardSignal,
  preferences: Pick<TraderOperatorPreferences, "minimumTelegramGrade" | "includeBTelegramSignals">,
): boolean {
  if (card.status !== "active") {
    return false;
  }
  if (!gradeMeetsMinimum(card.grade, preferences.minimumTelegramGrade)) {
    return false;
  }
  if (card.grade === "B" && !preferences.includeBTelegramSignals) {
    return false;
  }
  return ["S+", "S", "A", "B"].includes(card.grade);
}

export function formatTraderTelegramSignal(card: TraderDashboardSignal): string {
  if (card.status !== "active") {
    return [
      `APEX WATCHING — ${card.symbol}`,
      "",
      card.shortReasoning || "Watching for structure confirmation.",
      `Grade: ${card.grade} | ${card.entry == null ? "No active levels yet." : `Entry: ${formatTraderPrice(card.entry)}`}`,
      "",
      "— APEX Intelligence",
    ].join("\n");
  }

  const smcSummary = card.smcAnalysis
    ? `SMC: ${card.smcAnalysis.killzone} · ${titleCase(card.smcAnalysis.pdLocation)} · ${card.smcAnalysis.inOTE ? "OTE ✓" : "OTE -" }`
    : null;
  const cotSummary = card.smcAnalysis?.cotBias && card.smcAnalysis.cotBias !== "unavailable"
    ? `COT: ${titleCase(card.smcAnalysis.cotBias)} (${card.smcAnalysis.cotStrength})${card.smcAnalysis.cotDivergence ? " · divergence" : ""}`
    : null;

  return [
    `APEX SIGNAL — ${card.symbol}`,
    "",
    `${card.symbol} • ${card.direction.toUpperCase()} • ${card.grade}`,
    `Direction: ${card.direction.toUpperCase()}`,
    `Grade: ${card.grade} | Session: ${card.session}`,
    `Setup: ${titleCase(card.setupType)}`,
    "",
    `Live price: ${formatTraderPrice(card.livePrice)}`,
    `Entry: ${formatTraderPrice(card.entry)} | SL: ${formatTraderPrice(card.sl)} | TP1: ${formatTraderPrice(card.tp1)}`,
    `TP2: ${formatTraderPrice(card.tp2)} | TP3: ${formatTraderPrice(card.tp3)}`,
    "",
    card.shortReasoning || buildTelegramReasons(card)[0] || "Setup remains valid under the current runtime read.",
    ...(smcSummary ? ["", smcSummary] : []),
    ...(cotSummary ? [cotSummary] : []),
    "",
    "— APEX Intelligence",
  ].join("\n");
}

export function defaultMeaningfulGrade(): TraderSignalGrade {
  return "B";
}

export function sortGradesAscending(): TraderSignalGrade[] {
  return [...GRADE_SEQUENCE_ASC];
}

export function directionFromTraderDirection(direction: TraderDirection): SignalDirection {
  if (direction === "long") return "buy";
  if (direction === "short") return "sell";
  return "none";
}
