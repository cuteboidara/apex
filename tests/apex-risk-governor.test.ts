import assert from "node:assert/strict";
import test from "node:test";

import { defaultMarketScopeConfig } from "@/src/config/marketScope";
import { RiskGovernor } from "@/src/risk/RiskGovernor";
import type { ApexConfig } from "@/src/lib/config";
import { ApexRepository } from "@/src/lib/repository";
import type { AllocationIntent } from "@/src/interfaces/contracts";

const config: ApexConfig = {
  databaseUrl: undefined,
  redisUrl: undefined,
  telegramBotToken: undefined,
  telegramChatId: undefined,
  mode: "paper",
  cycleIntervalMinutes: 15,
  maxGrossExposure: 1,
  maxNetExposure: 0.5,
  drawdownWarningPct: 3,
  drawdownHardLimitPct: 5,
  maxSlippageBps: 15,
  marketScope: defaultMarketScopeConfig,
  activeSymbols: ["EURUSD"],
  primaryEntryStyle: "trend_pullback",
  enabledEntryStyles: ["trend_pullback", "session_breakout", "range_reversal"],
  disabledEntryStyles: [],
  pairProfiles: { ...defaultMarketScopeConfig.pairProfiles },
  scopeSkips: {
    symbols: [],
    pods: [],
  },
  activePods: ["trend", "breakout", "mean-reversion", "volatility-regime", "execution-advisory"],
  defaultVenue: "oanda",
  requireLiveData: true,
  blockHighVolChaotic: true,
  maxActiveSymbols: 6,
  maxSymbolPosition: 0.2,
  maxNotionalUsd: 100000,
  volatilityTarget: 0.3,
  defaultRecoveryMode: "normal",
  minimumTelegramGrade: "A",
  includeBTelegramSignals: false,
  showBlockedSignalsOnMainDashboard: false,
  showAdvancedInternals: false,
};

function makeIntent(symbol: string, targetPosition: number): AllocationIntent {
  return {
    candidate_id: `sig_${symbol}`,
    ts: Date.now(),
    symbol_canonical: symbol,
    timeframe: "15m",
    regime: "trend",
    session: "london",
    direction: targetPosition >= 0 ? "buy" : "sell",
    confidence: 0.8,
    entry_style: "trend_pullback",
    selected_pods: ["trend"],
    pod_weights: { trend: 0.8 },
    pod_vote_summary: {
      directional: [],
      gating: [],
    },
    trade_plan: null,
    entry: null,
    sl: null,
    tp1: null,
    tp2: null,
    tp3: null,
    target_position: targetPosition,
    reasoning: [],
    reason_codes: [],
    veto_reasons: [],
    portfolio_context: {
      gross_exposure: Math.abs(targetPosition),
      net_exposure: targetPosition,
      active_symbols: targetPosition === 0 ? 0 : 1,
    },
  };
}

test("risk governor rejects hard limit breaches regardless of other checks", () => {
  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);
  repository.replacePosition("EURUSD", 0.18);

  const intent: AllocationIntent = {
    ...makeIntent("EURUSD", 0.15),
    portfolio_context: {
      gross_exposure: 0.18,
      net_exposure: 0.18,
      active_symbols: 1,
    },
  };

  const decision = governor.evaluate({
    intent,
    price: 200000,
    volatilityRegime: "normal",
  });

  assert.equal(decision.approval_status, "rejected");
  assert.equal(decision.approved_size_multiplier, 0);
  assert.equal(decision.risk_check_results.position_limit, false);
});

test("risk governor rejects inactive symbols before other approvals can pass", () => {
  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);

  const intent: AllocationIntent = {
    ...makeIntent("GBPUSD", 0.1),
    portfolio_context: {
      gross_exposure: 0,
      net_exposure: 0,
      active_symbols: 0,
    },
  };

  const decision = governor.evaluate({
    intent,
    price: 1.27,
    volatilityRegime: "normal",
  });

  assert.equal(decision.approval_status, "rejected");
  assert.equal(decision.risk_check_results.symbol_scope, false);
});

test("risk governor avoids duplicating the RR veto when there is no directional consensus", () => {
  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);

  const decision = governor.evaluate({
    intent: {
      ...makeIntent("EURUSD", 0),
      direction: "none",
    },
    price: 1.09,
    volatilityRegime: "normal",
  });

  assert.ok(decision.veto_reasons.includes("NO_DIRECTIONAL_CONSENSUS"));
  assert.ok(!decision.veto_reasons.includes("PAIR_RR_BELOW_MIN"));
});
