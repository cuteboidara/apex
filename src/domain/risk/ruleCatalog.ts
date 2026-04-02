import type { NoTradeReasonCode, RiskDecision } from "@/src/interfaces/contracts";

export const LEGACY_VETO_RULE_CODE_MAP: Record<NoTradeReasonCode, string> = {
  NEWS_WINDOW: "market.news_window",
  LOW_RR: "policy.minimum_risk_reward",
  OFF_SESSION: "market.session_lock",
  VOL_TOO_HIGH: "market.volatility_too_high",
  VOL_TOO_LOW: "market.volatility_too_low",
  CONFLICTING_REGIME: "market.regime_conflict",
  TOO_CLOSE_TO_STRUCTURE: "market.too_close_to_structure",
  DUPLICATE_SIGNAL: "policy.duplicate_signal",
  SYMBOL_NOT_ACTIVE: "policy.symbol_scope",
  SYMBOL_NOT_SUPPORTED: "policy.symbol_scope",
  ENTRY_STYLE_DISABLED: "policy.entry_style_disabled",
  PAIR_CONFIDENCE_BELOW_MIN: "policy.pair_profile_confidence_below_min",
  PAIR_RR_BELOW_MIN: "policy.pair_profile_risk_reward_below_min",
  PAIR_SESSION_NOT_ALLOWED: "policy.pair_profile_disallows_trade",
  PAIR_SIGNAL_LIMIT_REACHED: "policy.pair_signal_limit_reached",
  SL_TOO_TIGHT: "execution.stop_distance_too_tight",
  SL_TOO_WIDE: "execution.stop_distance_too_wide",
  SPREAD_ABNORMAL: "execution.spread_too_wide",
  NO_DIRECTIONAL_CONSENSUS: "policy.no_directional_consensus",
  NO_TRADEABILITY_EDGE: "execution.trade_plan_unavailable",
  MARKET_DATA_DEGRADED: "market.data_degraded",
  SESSION_LOCK: "market.session_lock",
  NEWS_LOCK: "market.news_lock",
  SIGNAL_EXPIRED: "policy.signal_expired",
  HIGHER_TIMEFRAME_CONFLICT: "market.higher_timeframe_conflict",
};

export const LEGACY_WARNING_RULE_CODE_MAP: Partial<Record<NoTradeReasonCode, string>> = {
  VOL_TOO_LOW: "market.volatility_too_low",
  TOO_CLOSE_TO_STRUCTURE: "market.too_close_to_structure",
  NEWS_LOCK: "market.news_lock",
};

export const RISK_CHECK_RULE_CODE_MAP: Partial<Record<keyof RiskDecision["risk_check_results"], string>> = {
  symbol_scope: "policy.symbol_scope",
  position_limit: "portfolio.max_symbol_position",
  notional_limit: "portfolio.max_notional",
  portfolio_exposure: "portfolio.max_total_exposure",
  drawdown: "portfolio.drawdown_limit",
  kill_switch: "policy.kill_switch_active",
  signal_quality: "policy.signal_quality_gate",
};
