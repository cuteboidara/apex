import { evaluateSymbolScope, getPairTradingProfile } from "@/src/config/marketScope";
import type { ApexConfig } from "@/src/lib/config";
import type { ApexRepository } from "@/src/lib/repository";
import type {
  AllocationIntent,
  FeatureSnapshot,
  NoTradeReasonCode,
  RiskDecision,
} from "@/src/interfaces/contracts";

function buildFallbackSnapshot(symbol: string, volatilityRegime = "normal"): FeatureSnapshot {
  return {
    snapshot_id: `snap_${symbol}`,
    ts: Date.now(),
    symbol_canonical: symbol,
    horizon: "15m",
    features: {
      atr_14: 0.004,
      volatility_regime: volatilityRegime === "low_vol_trending" ? 0 : volatilityRegime === "high_vol_chaotic" ? 2 : volatilityRegime === "compressing" ? 3 : 1,
      mid: 1.1,
    },
    quality: {
      staleness_ms: 0,
      completeness: 1,
      confidence: 1,
    },
    context: {
      timeframe: "15m",
      source: "compat",
      quality_flag: "clean",
      session: {
        session: "london",
        tradingDay: "1970-01-01",
        hourBucket: 8,
        minutesSinceSessionOpen: 60,
      },
      economic_event: {
        majorNewsFlag: false,
        minutesToNextHighImpactEvent: null,
        minutesSinceLastHighImpactEvent: null,
        eventType: null,
      },
    },
  };
}

export class RiskGovernor {
  constructor(
    private readonly repository: ApexRepository,
    private readonly config: ApexConfig,
  ) {}

  checkPositionLimit(symbol: string, size: number): { passed: boolean; reason: string } {
    const existing = this.repository.getPosition(symbol);
    const projected = Math.abs(existing + size);
    return {
      passed: projected <= this.config.maxSymbolPosition,
      reason: `projected_position=${projected.toFixed(4)} limit=${this.config.maxSymbolPosition.toFixed(4)}`,
    };
  }

  checkNotionalLimit(symbol: string, size: number, price: number): { passed: boolean; reason: string } {
    const notional = Math.abs(size * price);
    return {
      passed: notional <= this.config.maxNotionalUsd,
      reason: `${symbol} notional=${notional.toFixed(2)} cap=${this.config.maxNotionalUsd.toFixed(2)}`,
    };
  }

  checkPortfolioExposure(intent: AllocationIntent): { passed: boolean; reason: string } {
    const currentPosition = this.repository.getPosition(intent.symbol_canonical);
    const postTradePosition = currentPosition + intent.target_position;
    const projectedGross = intent.portfolio_context.gross_exposure - Math.abs(currentPosition) + Math.abs(postTradePosition);
    const projectedNet = intent.portfolio_context.net_exposure - currentPosition + postTradePosition;
    return {
      passed: projectedGross <= this.config.maxGrossExposure && Math.abs(projectedNet) <= this.config.maxNetExposure,
      reason: `gross=${projectedGross.toFixed(3)} net=${projectedNet.toFixed(3)}`,
    };
  }

  checkDrawdown(): { passed: boolean; warning: boolean; hard: boolean; reason: string } {
    const drawdown = this.repository.getRiskState().current_drawdown_pct;
    const hard = drawdown <= -Math.abs(this.config.drawdownHardLimitPct);
    const warning = drawdown <= -Math.abs(this.config.drawdownWarningPct);
    return {
      passed: !hard,
      warning,
      hard,
      reason: `drawdown=${drawdown.toFixed(2)} warning=-${this.config.drawdownWarningPct} hard=-${this.config.drawdownHardLimitPct}`,
    };
  }

  checkKillSwitch(symbol: string): { passed: boolean; reason: string } {
    const symbolQuarantine = this.repository.getQuarantinedSymbols()[symbol];
    const globalKill = this.repository.isKillSwitchActive();
    return {
      passed: !globalKill && !symbolQuarantine,
      reason: globalKill ? "global kill switch active" : symbolQuarantine ? `symbol halted:${symbolQuarantine}` : "none",
    };
  }

  private collectQualityVetoes(input: {
    candidate: AllocationIntent;
    snapshot: FeatureSnapshot;
    price: number;
  }): {
    vetoReasons: NoTradeReasonCode[];
    warningReasons: NoTradeReasonCode[];
  } {
    const vetoReasons = [...(input.candidate.veto_reasons ?? [])];
    const warningReasons: NoTradeReasonCode[] = [];
    const pairProfile = getPairTradingProfile(input.candidate.symbol_canonical, this.config.marketScope);
    const tradeability = input.snapshot.context.tradeability;
    const structure = input.snapshot.context.market_structure;
    const session = input.snapshot.context.session.session;
    const economicEvent = input.snapshot.context.economic_event;
    const riskReward = input.candidate.trade_plan?.risk_reward_ratio ?? 0;
    const stopDistance = input.candidate.entry != null && input.candidate.sl != null
      ? Math.abs(input.candidate.entry - input.candidate.sl)
      : 0;
    const atr = Math.max(input.snapshot.features.atr_14 ?? 0, input.price * 0.001);

    if (input.candidate.direction === "none" || input.candidate.target_position === 0) {
      vetoReasons.push("NO_DIRECTIONAL_CONSENSUS");
    }
    if (session === "off_hours") {
      vetoReasons.push("OFF_SESSION", "SESSION_LOCK");
    }
    if (economicEvent.majorNewsFlag) {
      vetoReasons.push("NEWS_WINDOW", "NEWS_LOCK");
    }
    if (pairProfile && !pairProfile.allowedSessions.includes(session as typeof pairProfile.allowedSessions[number])) {
      vetoReasons.push("PAIR_SESSION_NOT_ALLOWED");
    }
    const hasNoDirectionalConsensus = vetoReasons.includes("NO_DIRECTIONAL_CONSENSUS");
    const shouldSkipPairRrVeto = riskReward === 0 && hasNoDirectionalConsensus;
    if (!shouldSkipPairRrVeto && riskReward < (pairProfile?.minRiskReward ?? 1.6)) {
      vetoReasons.push(pairProfile ? "PAIR_RR_BELOW_MIN" : "LOW_RR");
    }
    if (stopDistance > 0 && stopDistance < atr * 0.25) {
      vetoReasons.push("SL_TOO_TIGHT");
    }
    if (stopDistance > atr * 2.5) {
      vetoReasons.push("SL_TOO_WIDE");
    }
    if (input.candidate.direction === "buy" && structure?.structureBias === "bearish") {
      vetoReasons.push("HIGHER_TIMEFRAME_CONFLICT", "CONFLICTING_REGIME");
    }
    if (input.candidate.direction === "sell" && structure?.structureBias === "bullish") {
      vetoReasons.push("HIGHER_TIMEFRAME_CONFLICT", "CONFLICTING_REGIME");
    }
    if (tradeability?.spreadEstimateBps != null && tradeability.spreadEstimateBps > 18) {
      vetoReasons.push("SPREAD_ABNORMAL");
    }
    if (tradeability?.volatilityState === "too_high") {
      vetoReasons.push("VOL_TOO_HIGH");
    }
    if (tradeability?.volatilityState === "too_low") {
      warningReasons.push("VOL_TOO_LOW");
    }
    if ((tradeability?.proximityToKeyStructure ?? 1) < atr * 0.15) {
      warningReasons.push("TOO_CLOSE_TO_STRUCTURE");
    }

    const duplicateSignal = this.repository.queryDecisionJournal({
      symbol: input.candidate.symbol_canonical,
      from_ts: input.snapshot.ts - 45 * 60 * 1000,
      to_ts: input.snapshot.ts,
    }).find(entry =>
      entry.direction === input.candidate.direction
      && (entry.final_action === "executed" || entry.final_action === "deferred"),
    );
    if (duplicateSignal) {
      vetoReasons.push("DUPLICATE_SIGNAL");
    }

    if (pairProfile) {
      const startOfDay = new Date(input.snapshot.ts);
      startOfDay.setUTCHours(0, 0, 0, 0);
      const signalsToday = this.repository.queryDecisionJournal({
        symbol: input.candidate.symbol_canonical,
        from_ts: startOfDay.getTime(),
        to_ts: input.snapshot.ts,
      }).filter(entry => entry.final_action === "executed" || entry.final_action === "deferred").length;
      if (signalsToday >= pairProfile.maxSignalsPerDay) {
        vetoReasons.push("PAIR_SIGNAL_LIMIT_REACHED");
      }
      if (input.candidate.confidence < pairProfile.minConfidence) {
        vetoReasons.push("PAIR_CONFIDENCE_BELOW_MIN");
      }
    }

    return {
      vetoReasons: [...new Set(vetoReasons)],
      warningReasons: [...new Set(warningReasons)],
    };
  }

  evaluate(input: {
    intent: AllocationIntent;
    snapshot?: FeatureSnapshot;
    price: number;
    volatilityRegime?: string;
  }): RiskDecision {
    const snapshot = input.snapshot ?? buildFallbackSnapshot(input.intent.symbol_canonical, input.volatilityRegime);
    const symbolScope = evaluateSymbolScope(
      input.intent.symbol_canonical,
      this.config.activeSymbols,
      this.config.marketScope,
    );
    const positionLimit = this.checkPositionLimit(input.intent.symbol_canonical, input.intent.target_position);
    const notionalLimit = this.checkNotionalLimit(input.intent.symbol_canonical, input.intent.target_position, input.price);
    const exposure = this.checkPortfolioExposure(input.intent);
    const drawdown = this.checkDrawdown();
    const killSwitch = this.checkKillSwitch(input.intent.symbol_canonical);
    const quality = this.collectQualityVetoes({
      candidate: input.intent,
      snapshot,
      price: input.price,
    });

    const checks = {
      symbol_scope: symbolScope.allowed,
      position_limit: positionLimit.passed,
      notional_limit: notionalLimit.passed,
      portfolio_exposure: exposure.passed,
      drawdown: drawdown.passed,
      kill_switch: killSwitch.passed,
      signal_quality: quality.vetoReasons.length === 0,
    };

    const hardRejected = !symbolScope.allowed
      || !positionLimit.passed
      || !notionalLimit.passed
      || !exposure.passed
      || !drawdown.passed
      || !killSwitch.passed
      || quality.vetoReasons.length > 0;
    const warningReduced = drawdown.warning || quality.warningReasons.length > 0;
    const approvalStatus = hardRejected
      ? "rejected"
      : warningReduced
        ? "approved_reduced"
        : "approved";
    const approvedMultiplier = approvalStatus === "approved"
      ? 1
      : approvalStatus === "approved_reduced"
        ? 0.5
        : 0;

    return {
      ts: Date.now(),
      scope: input.intent.symbol_canonical,
      approval_status: approvalStatus,
      approved_size_multiplier: approvedMultiplier,
      risk_check_results: checks,
      veto_reasons: [...new Set([
        ...quality.vetoReasons,
        ...(symbolScope.allowed ? [] : [symbolScope.reason!]),
      ])],
      warning_reasons: quality.warningReasons,
      override_instructions: hardRejected
        ? [
          symbolScope.reason ?? "symbol_scope_ok",
          positionLimit.reason,
          notionalLimit.reason,
          exposure.reason,
          drawdown.reason,
          killSwitch.reason,
          quality.vetoReasons.join(", "),
        ].filter(Boolean).join(" | ")
        : warningReduced
          ? "Signal approved at reduced size because warning thresholds are active."
          : undefined,
      de_risking_action: this.repository.isKillSwitchActive()
        ? "kill_switch"
        : drawdown.hard
          ? "full_flatten"
          : warningReduced
            ? "partial_flatten"
            : "none",
      kill_switch_active: this.repository.isKillSwitchActive(),
    };
  }
}
