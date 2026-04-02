import assert from "node:assert/strict";
import test from "node:test";

import { defaultMarketScopeConfig } from "@/src/config/marketScope";
import { aggregateRiskResults } from "@/src/domain/risk/aggregateRiskResults";
import { RiskEngine } from "@/src/domain/risk/RiskEngine";
import { LegacyRiskParityModule } from "@/src/domain/risk/modules/LegacyRiskParityModule";
import { ExecutionFeasibilityRiskModule } from "@/src/domain/risk/modules/ExecutionFeasibilityRiskModule";
import { MarketConditionsRiskModule } from "@/src/domain/risk/modules/MarketConditionsRiskModule";
import { PolicyRulesRiskModule } from "@/src/domain/risk/modules/PolicyRulesRiskModule";
import { PortfolioRiskModule } from "@/src/domain/risk/modules/PortfolioRiskModule";
import type { RiskModule, RiskModuleResult } from "@/src/domain/risk/types";
import type { ApexConfig } from "@/src/lib/config";
import { ApexRepository } from "@/src/lib/repository";
import type { AllocationIntent, FeatureSnapshot } from "@/src/interfaces/contracts";
import { RiskGovernor } from "@/src/risk/RiskGovernor";

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

function makeSnapshot(symbol = "EURUSD"): FeatureSnapshot {
  return {
    snapshot_id: `snap_${symbol}`,
    ts: Date.now(),
    symbol_canonical: symbol,
    horizon: "15m",
    features: {
      atr_14: 0.004,
      mid: 1.1,
      spread_bps: 2,
      volatility_raw: 1,
      volatility_regime: 1,
    },
    quality: {
      staleness_ms: 0,
      completeness: 1,
      confidence: 1,
    },
    context: {
      timeframe: "15m",
      source: "test",
      quality_flag: "clean",
      session: {
        session: "london",
        tradingDay: "2026-03-28",
        hourBucket: 9,
        minutesSinceSessionOpen: 60,
      },
      economic_event: {
        majorNewsFlag: false,
        minutesToNextHighImpactEvent: null,
        minutesSinceLastHighImpactEvent: null,
        eventType: null,
      },
      market_structure: {
        recentSwingHigh: 1.102,
        recentSwingLow: 1.098,
        previousSwingHigh: 1.101,
        previousSwingLow: 1.097,
        higherHighState: true,
        lowerLowState: false,
        structureBias: "bullish",
        breakOfStructure: "bullish",
        changeOfCharacter: "none",
        distanceToRecentStructure: 0.001,
        distanceToSessionHigh: 0.001,
        distanceToSessionLow: 0.001,
        distanceToPreviousDayHigh: 0.001,
        distanceToPreviousDayLow: 0.001,
      },
      tradeability: {
        spreadEstimateBps: 2,
        volatilityState: "acceptable",
        rewardToRiskFeasible: true,
        rewardToRiskPotential: 2.1,
        proximityToKeyStructure: 0.003,
        signalCrowdingOnPair: 0,
        pairVolatilityRegime: "normal",
      },
    },
  };
}

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
    trade_plan: {
      entry: 1.1,
      sl: 1.096,
      tp1: 1.108,
      tp2: 1.11,
      tp3: 1.112,
      risk_reward_ratio: 2,
      entry_zone: { low: 1.099, high: 1.101, label: "entry" },
      invalidation_zone: { low: 1.095, high: 1.097, label: "invalid" },
      pre_entry_invalidation: "pre",
      post_entry_invalidation: "post",
      expires_after_bars: 3,
      expires_at: Date.now() + 3 * 15 * 60 * 1000,
    },
    entry: 1.1,
    sl: 1.096,
    tp1: 1.108,
    tp2: 1.11,
    tp3: 1.112,
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

function createRiskEngine(governor: RiskGovernor) {
  return new RiskEngine(
    new LegacyRiskParityModule(governor),
    [
      new PortfolioRiskModule(),
      new MarketConditionsRiskModule(),
      new ExecutionFeasibilityRiskModule(),
      new PolicyRulesRiskModule(),
    ],
  );
}

test("decomposed risk engine preserves approved legacy outcomes", async () => {
  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);
  const engine = createRiskEngine(governor);

  const result = await engine.evaluate({
    cycle_id: "cycle_approved",
    candidate: makeIntent("EURUSD", 0.1),
    snapshot: makeSnapshot(),
    price: 1.1,
    repository,
    config,
    legacy_governor: governor,
    aggregated_pod_decision: null,
  });

  assert.equal(result.legacy_decision.approval_status, "approved");
  assert.equal(result.decision, "approved");
  assert.equal(result.authoritative_source, "legacy_risk_parity");
  assert.equal(result.shadow_mismatch, false);
});

test("decomposed risk engine preserves modified legacy outcomes and structured adjustments", async () => {
  const repository = new ApexRepository();
  repository.setRiskState({ current_drawdown_pct: -3.5 });
  const governor = new RiskGovernor(repository, config);
  const engine = createRiskEngine(governor);

  const result = await engine.evaluate({
    cycle_id: "cycle_modified",
    candidate: makeIntent("EURUSD", 0.1),
    snapshot: makeSnapshot(),
    price: 1.1,
    repository,
    config,
    legacy_governor: governor,
    aggregated_pod_decision: null,
  });

  assert.equal(result.legacy_decision.approval_status, "approved_reduced");
  assert.equal(result.decision, "modified");
  assert.ok(result.size_adjustments);
  assert.ok(result.policy_evaluations.some(module => module.adjustments.length > 0));
});

test("blocked legacy results stay blocked and expose stable rule codes", async () => {
  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);
  const engine = createRiskEngine(governor);

  const result = await engine.evaluate({
    cycle_id: "cycle_blocked",
    candidate: makeIntent("GBPUSD", 0.1),
    snapshot: makeSnapshot("GBPUSD"),
    price: 1.27,
    repository,
    config,
    legacy_governor: governor,
    aggregated_pod_decision: null,
  });

  assert.equal(result.legacy_decision.approval_status, "rejected");
  assert.equal(result.decision, "blocked");
  assert.ok(result.blocking_rules.length > 0);
  assert.ok(result.blocking_rules.every(rule => rule.includes(".")));
});

test("shadow mismatches are recorded and logged when shadow modules diverge from legacy parity", async () => {
  class AlwaysPassShadowModule implements RiskModule {
    async evaluate(): Promise<RiskModuleResult> {
      return {
        module_name: "always_pass",
        module_version: "1.0.0",
        decision: "pass",
        blocking_rules: [],
        warnings: [],
        adjustments: [],
        metadata: {},
      };
    }
  }

  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);
  const engine = new RiskEngine(
    new LegacyRiskParityModule(governor),
    [new AlwaysPassShadowModule()],
  );

  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (value?: unknown) => {
    warnings.push(String(value));
  };

  try {
    const result = await engine.evaluate({
      cycle_id: "cycle_mismatch",
      candidate: makeIntent("GBPUSD", 0.1),
      snapshot: makeSnapshot("GBPUSD"),
      price: 1.27,
      repository,
      config,
      legacy_governor: governor,
      aggregated_pod_decision: null,
    });

    assert.equal(result.shadow_mismatch, true);
    assert.ok(warnings.some(line => line.includes("risk_shadow_mismatch_count")));
  } finally {
    console.warn = originalWarn;
  }
});

test("warning-only module results do not block the aggregate decision", () => {
  const aggregate = aggregateRiskResults([{
    module_name: "warning_only",
    module_version: "1.0.0",
    decision: "pass",
    blocking_rules: [],
    warnings: [{
      warning_code: "market.volatility_too_low",
      reason: "volatility too low",
    }],
    adjustments: [],
    metadata: {},
  }]);

  assert.equal(aggregate.decision, "approved");
  assert.deepEqual(aggregate.blocking_rules, []);
});
