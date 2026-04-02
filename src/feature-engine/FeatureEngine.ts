import { createId } from "@/src/lib/ids";
import type { ApexRepository } from "@/src/lib/repository";
import { classifyFxSession } from "@/src/data-plant/session";
import { emptyEconomicEventContext } from "@/src/data-plant/economicEvents";
import {
  clamp01,
  encodeSessionLabel,
  encodeVolatilityRegime,
  type CanonicalMarketEvent,
  type DirectionalState,
  type EconomicEventContext,
  type FeatureHorizon,
  type FeatureSnapshot,
  type NormalizedCandle,
  type PairVolatilityRegime,
  type SessionCompressionState,
  type SessionContext,
  type StructureBias,
  type TradeabilityVolatilityState,
  type VolatilityRegimeState,
} from "@/src/interfaces/contracts";
import { atr, bollinger, ema, mean, rsi, sma, stdev, zscore } from "@/src/feature-engine/indicators";
import {
  computeAtrBaseline,
  computeMarketStructure,
  computeSessionFeatures,
  computeTradeability,
  type ObservedBar,
} from "@/src/feature-engine/fxFeatures";
import { analyzeSMC } from "@/src/smc";

type MarketInput = CanonicalMarketEvent | NormalizedCandle;

type SymbolState = {
  bars: ObservedBar[];
  prices: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
  bids: number[];
  asks: number[];
  lastEventTs: number;
  lastTimeframe: FeatureSnapshot["context"]["timeframe"];
  lastSource: string;
  lastQualityFlag: FeatureSnapshot["context"]["quality_flag"];
  sessionContext: SessionContext;
  economicEventContext: EconomicEventContext;
};

function isNormalizedCandle(input: MarketInput): input is NormalizedCandle {
  return "timestampOpen" in input && "timestampClose" in input;
}

function encodeDirectionalState(state: DirectionalState): number {
  if (state === "bullish") return 1;
  if (state === "bearish") return -1;
  return 0;
}

function encodeStructureBias(state: StructureBias): number {
  if (state === "bullish") return 1;
  if (state === "bearish") return -1;
  return 0;
}

function encodeCompressionState(state: SessionCompressionState): number {
  return state === "compressed" ? 1 : 0;
}

function encodeTradeabilityVolatilityState(state: TradeabilityVolatilityState): number {
  if (state === "too_low") return 0;
  if (state === "too_high") return 2;
  return 1;
}

function encodePairVolatilityRegime(state: PairVolatilityRegime): number {
  if (state === "low") return 0;
  if (state === "high") return 2;
  return 1;
}

export class FeatureEngine {
  private readonly state = new Map<string, SymbolState>();

  constructor(private readonly repository: ApexRepository) {}

  private buildObservedBar(input: MarketInput): ObservedBar {
    if (isNormalizedCandle(input)) {
      return {
        open: input.open,
        high: input.high,
        low: input.low,
        close: input.close,
        volume: input.volume ?? 0,
        bid: Math.min(input.close, input.low + (input.close - input.low) * 0.25),
        ask: Math.max(input.close, input.high - (input.high - input.close) * 0.25),
        timestampOpen: input.timestampOpen,
        timestampClose: input.timestampClose,
        session: {
          session: input.session,
          tradingDay: input.tradingDay,
          hourBucket: input.hourBucket,
          minutesSinceSessionOpen: input.minutesSinceSessionOpen,
        },
        economicEvent: {
          majorNewsFlag: input.majorNewsFlag,
          minutesToNextHighImpactEvent: input.minutesToNextHighImpactEvent,
          minutesSinceLastHighImpactEvent: input.minutesSinceLastHighImpactEvent,
          eventType: input.eventType,
        },
      };
    }

    const timestampOpen = input.timestamp_open ?? input.ts_exchange;
    const timestampClose = input.timestamp_close ?? input.ts_exchange;
    const price = input.price ?? 0;
    return {
      open: price,
      high: Math.max(price, input.ask ?? price),
      low: Math.min(price, input.bid ?? price),
      close: price,
      volume: input.size ?? 0,
      bid: input.bid ?? price,
      ask: input.ask ?? price,
      timestampOpen,
      timestampClose,
      session: classifyFxSession(timestampOpen),
      economicEvent: {
        majorNewsFlag: input.major_news_flag ?? false,
        minutesToNextHighImpactEvent: input.minutes_to_next_high_impact_event ?? null,
        minutesSinceLastHighImpactEvent: input.minutes_since_last_high_impact_event ?? null,
        eventType: input.event_type_label ?? null,
      },
    };
  }

  consume(input: MarketInput): void {
    const symbol = isNormalizedCandle(input) ? input.symbol : input.symbol_canonical;
    const current = this.state.get(symbol) ?? {
      bars: [],
      prices: [],
      highs: [],
      lows: [],
      volumes: [],
      bids: [],
      asks: [],
      lastEventTs: isNormalizedCandle(input) ? input.timestampClose : input.ts_received,
      lastTimeframe: isNormalizedCandle(input) ? input.timeframe : "15m",
      lastSource: isNormalizedCandle(input) ? input.source : input.venue,
      lastQualityFlag: isNormalizedCandle(input) ? input.qualityFlag : (input.quality_flag ?? "clean"),
      sessionContext: isNormalizedCandle(input)
        ? {
          session: input.session,
          tradingDay: input.tradingDay,
          hourBucket: input.hourBucket,
          minutesSinceSessionOpen: input.minutesSinceSessionOpen,
        }
        : classifyFxSession(input.timestamp_open ?? input.ts_exchange),
      economicEventContext: isNormalizedCandle(input)
        ? {
          majorNewsFlag: input.majorNewsFlag,
          minutesToNextHighImpactEvent: input.minutesToNextHighImpactEvent,
          minutesSinceLastHighImpactEvent: input.minutesSinceLastHighImpactEvent,
          eventType: input.eventType,
        }
        : {
          majorNewsFlag: input.major_news_flag ?? false,
          minutesToNextHighImpactEvent: input.minutes_to_next_high_impact_event ?? null,
          minutesSinceLastHighImpactEvent: input.minutes_since_last_high_impact_event ?? null,
          eventType: input.event_type_label ?? null,
        },
    };

    const observedBar = this.buildObservedBar(input);
    current.bars.push(observedBar);
    current.prices.push(observedBar.close);
    current.highs.push(observedBar.high);
    current.lows.push(observedBar.low);
    current.volumes.push(observedBar.volume);
    current.bids.push(observedBar.bid);
    current.asks.push(observedBar.ask);
    current.lastEventTs = observedBar.timestampClose;
    current.lastTimeframe = isNormalizedCandle(input) ? input.timeframe : (input.timeframe ?? current.lastTimeframe ?? "15m");
    current.lastSource = isNormalizedCandle(input) ? input.source : (input.source ?? input.venue);
    current.lastQualityFlag = isNormalizedCandle(input) ? input.qualityFlag : (input.quality_flag ?? "clean");
    current.sessionContext = observedBar.session;
    current.economicEventContext = observedBar.economicEvent;

    current.bars = current.bars.slice(-400);
    current.prices = current.prices.slice(-400);
    current.highs = current.highs.slice(-400);
    current.lows = current.lows.slice(-400);
    current.volumes = current.volumes.slice(-400);
    current.bids = current.bids.slice(-400);
    current.asks = current.asks.slice(-400);

    this.state.set(symbol, current);
  }

  private detectRegime(symbolState: SymbolState): VolatilityRegimeState {
    const recentVol = stdev(symbolState.prices.slice(-20));
    const baselineVol = stdev(symbolState.prices.slice(-80));
    const momentum = (symbolState.prices.at(-1) ?? 0) - (symbolState.prices.at(-20) ?? symbolState.prices.at(-1) ?? 0);
    const boll = bollinger(symbolState.prices, Math.min(20, symbolState.prices.length || 1));
    const widthPct = boll.upper === 0 ? 0 : (boll.upper - boll.lower) / Math.max(boll.upper, 0.0001);

    if (baselineVol > 0 && recentVol > baselineVol * 1.8) {
      return "high_vol_chaotic";
    }
    if (Math.abs(momentum) > recentVol * 4 && recentVol > 0) {
      return "low_vol_trending";
    }
    if (widthPct < 0.015) {
      return "compressing";
    }
    return "normal";
  }

  private getSignalCrowdingOnPair(symbol: string, ts: number): number {
    const lookbackStart = ts - (6 * 60 * 60_000);
    return this.repository.queryDecisionJournal({
      symbol,
      from_ts: lookbackStart,
      to_ts: ts,
    }).length;
  }

  buildSnapshot(symbol: string, horizon: FeatureHorizon = "15m"): FeatureSnapshot | null {
    const current = this.state.get(symbol);
    if (!current || current.prices.length < 5) {
      return null;
    }

    const latestPrice = current.prices.at(-1) ?? 0;
    const sma20 = sma(current.prices, 20);
    const sma50 = sma(current.prices, 50);
    const ema9 = ema(current.prices, 9);
    const ema21 = ema(current.prices, 21);
    const rsi14 = rsi(current.prices, 14);
    const atr14 = atr(current.highs, current.lows, current.prices, 14);
    const atrBaseline = computeAtrBaseline(current.bars.slice(-160));
    const boll = bollinger(current.prices, 20);
    const volumeZ = zscore(current.volumes, 30);
    const mid = ((current.bids.at(-1) ?? latestPrice) + (current.asks.at(-1) ?? latestPrice)) / 2;
    const spread = Math.max(0, (current.asks.at(-1) ?? latestPrice) - (current.bids.at(-1) ?? latestPrice));
    const spreadBps = mid === 0 ? 0 : (spread / mid) * 10_000;
    const momentum1h = latestPrice - (current.prices.at(-4) ?? latestPrice);
    const momentum4h = latestPrice - (current.prices.at(-16) ?? latestPrice);
    const volatility = stdev(current.prices.slice(-20));
    const volatilityRegime = this.detectRegime(current);
    const newsContext = current.economicEventContext ?? emptyEconomicEventContext();
    const structure = computeMarketStructure({
      bars: current.bars,
      latestPrice,
      atr14,
    });
    const sessionFeatures = computeSessionFeatures({
      bars: current.bars,
      latestPrice,
      atr14,
      atrBaseline,
    });
    const tradeability = computeTradeability({
      latestPrice,
      atr14,
      spreadBps,
      structure,
      sessionFeatures,
      signalCrowdingOnPair: this.getSignalCrowdingOnPair(symbol, Date.now()),
    });

    const features = {
      sma_20: sma20,
      sma_50: sma50,
      ema_9: ema9,
      ema_21: ema21,
      rsi_14: rsi14,
      atr_14: atr14,
      atr_relative_to_normal: sessionFeatures.atrRelativeToNormal,
      bollinger_upper: boll.upper,
      bollinger_lower: boll.lower,
      bollinger_pct_b: boll.pctB,
      volume_zscore: volumeZ,
      price_momentum_1h: momentum1h,
      price_momentum_4h: momentum4h,
      spread_bps: spreadBps,
      volatility_raw: volatility,
      volatility_regime: encodeVolatilityRegime(volatilityRegime),
      session_code: encodeSessionLabel(current.sessionContext.session),
      hour_bucket: current.sessionContext.hourBucket,
      minutes_since_session_open: current.sessionContext.minutesSinceSessionOpen,
      major_news_flag: newsContext.majorNewsFlag ? 1 : 0,
      minutes_to_next_high_impact_event: newsContext.minutesToNextHighImpactEvent ?? -1,
      minutes_since_last_high_impact_event: newsContext.minutesSinceLastHighImpactEvent ?? -1,
      recent_swing_high: structure.recentSwingHigh ?? 0,
      recent_swing_low: structure.recentSwingLow ?? 0,
      previous_swing_high: structure.previousSwingHigh ?? 0,
      previous_swing_low: structure.previousSwingLow ?? 0,
      higher_high_state: structure.higherHighState ? 1 : 0,
      lower_low_state: structure.lowerLowState ? 1 : 0,
      structure_bias: encodeStructureBias(structure.structureBias),
      break_of_structure: encodeDirectionalState(structure.breakOfStructure),
      change_of_character: encodeDirectionalState(structure.changeOfCharacter),
      distance_to_recent_structure: Number.isFinite(structure.distanceToRecentStructure) ? structure.distanceToRecentStructure : 0,
      distance_to_session_high: structure.distanceToSessionHigh,
      distance_to_session_low: structure.distanceToSessionLow,
      distance_to_previous_day_high: structure.distanceToPreviousDayHigh,
      distance_to_previous_day_low: structure.distanceToPreviousDayLow,
      asia_range_size: sessionFeatures.asiaRangeSize,
      london_range_size: sessionFeatures.londonRangeSize,
      new_york_opening_expansion: sessionFeatures.newYorkOpeningExpansion,
      session_breakout_state: encodeDirectionalState(sessionFeatures.sessionBreakoutState),
      session_compression_state: encodeCompressionState(sessionFeatures.sessionCompressionState),
      tradeability_volatility_state: encodeTradeabilityVolatilityState(tradeability.volatilityState),
      reward_to_risk_feasible: tradeability.rewardToRiskFeasible ? 1 : 0,
      reward_to_risk_potential: tradeability.rewardToRiskPotential,
      proximity_to_key_structure: tradeability.proximityToKeyStructure,
      signal_crowding_same_pair: tradeability.signalCrowdingOnPair,
      pair_volatility_regime: encodePairVolatilityRegime(tradeability.pairVolatilityRegime),
      mid,
      imbalance: mean(current.bids.slice(-5)) - mean(current.asks.slice(-5)),
    } satisfies Record<string, number>;

    const completenessCount = Object.values(features).filter(value => Number.isFinite(value)).length;
    const staleness = Math.max(0, Date.now() - current.lastEventTs);
    const completeness = completenessCount / Object.keys(features).length;
    const confidence = clamp01((completeness * 0.6) + (staleness < 15 * 60 * 1000 ? 0.4 : 0.1));
    const smcAnalysis = analyzeSMC(
      symbol,
      current.bars.map(bar => ({
        time: bar.timestampClose,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      })),
      mid || latestPrice || null,
      "neutral",
    );

    const snapshot: FeatureSnapshot = {
      snapshot_id: createId("snap"),
      ts: Date.now(),
      symbol_canonical: symbol,
      horizon,
      features,
      quality: {
        staleness_ms: staleness,
        completeness: clamp01(completeness),
        confidence,
      },
      context: {
        timeframe: current.lastTimeframe,
        source: current.lastSource,
        quality_flag: current.lastQualityFlag,
        session: current.sessionContext,
        economic_event: current.economicEventContext,
        market_structure: structure,
        session_features: sessionFeatures,
        tradeability,
      },
      smcAnalysis,
    };

    void this.repository.appendFeatureSnapshot(snapshot);
    return snapshot;
  }

  getLatestState(symbol: string): SymbolState | null {
    return this.state.get(symbol) ?? null;
  }
}
