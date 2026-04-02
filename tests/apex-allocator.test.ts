import assert from "node:assert/strict";
import test from "node:test";

import { defaultMarketScopeConfig } from "@/src/config/marketScope";
import { PortfolioAllocator } from "@/src/allocator/PortfolioAllocator";
import type { ApexConfig } from "@/src/lib/config";
import { ApexRepository } from "@/src/lib/repository";
import type { AlphaPodOutput } from "@/src/interfaces/contracts";

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

function podOutput(pod_id: string, confidence: number, recommended_action: AlphaPodOutput["recommended_action"], state_assessment?: string): AlphaPodOutput {
  if (pod_id === "volatility-regime") {
    return {
      pod_id,
      ts: Date.now(),
      symbol_canonical: "EURUSD",
      decision_horizon: "15m",
      signal_type: "regime",
      confidence,
      recommended_action,
      constraints: {},
      diagnostics: {},
      model_version: "1.0.0",
      state_assessment,
      pod_category: "gating",
      entry_style: "support",
      rationale: [],
      gate_status: "allow",
      veto_reasons: [],
    };
  }

  return {
    pod_id,
    ts: Date.now(),
    symbol_canonical: "EURUSD",
    decision_horizon: "15m",
    signal_type: "predictive",
    confidence,
    recommended_action,
    constraints: {},
    diagnostics: {},
    model_version: "1.0.0",
    pod_category: "directional",
    entry_style: pod_id === "mean-reversion" ? "range_reversal" : "trend_pullback",
    rationale: [],
    direction: recommended_action === "long" ? "buy" : recommended_action === "short" ? "sell" : "none",
    score: confidence,
    regime: "trend",
    regime_alignment: confidence,
    tradeability_alignment: confidence,
    entry_zone: null,
    invalidation_zone: null,
  };
}

test("allocator upweights trend pod in low-vol trending regime", () => {
  const repository = new ApexRepository();
  const allocator = new PortfolioAllocator(repository, config);
  const allocation = allocator.allocate("EURUSD", [
    podOutput("trend", 0.8, "long"),
    podOutput("mean-reversion", 0.8, "short"),
    podOutput("volatility-regime", 0.7, "hold", "low_vol_trending"),
  ]);

  assert.ok(allocation.pod_weights.trend > allocation.pod_weights["mean-reversion"]);
  assert.ok(allocation.target_position > 0);
});

test("allocator returns a zero target with scope reason for inactive symbols", () => {
  const repository = new ApexRepository();
  const allocator = new PortfolioAllocator(repository, config);

  const allocation = allocator.allocate("GBPUSD", [
    podOutput("trend", 0.8, "long"),
  ]);

  assert.equal(allocation.target_position, 0);
  assert.ok(allocation.reason_codes.includes("SYMBOL_NOT_ACTIVE"));
});

test("allocator treats a 0.04 weighted directional read as actionable under the relaxed band", () => {
  const repository = new ApexRepository();
  const allocator = new PortfolioAllocator(repository, config);

  const allocation = allocator.allocate("EURUSD", [
    podOutput("mean-reversion", 0.04, "long"),
  ]);

  assert.equal(allocation.direction, "buy");
  assert.ok(allocation.target_position > 0);
});
