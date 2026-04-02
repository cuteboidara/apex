import assert from "node:assert/strict";
import test from "node:test";

import { defaultMarketScopeConfig } from "@/src/config/marketScope";
import { RiskEngine } from "@/src/domain/risk/RiskEngine";
import { LegacyRiskParityModule } from "@/src/domain/risk/modules/LegacyRiskParityModule";
import type { RiskModule, RiskModuleResult } from "@/src/domain/risk/types";
import { prisma } from "@/src/infrastructure/db/prisma";
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
      expires_at: Date.now() + 60_000,
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
      active_symbols: 1,
    },
  };
}

class MirrorLegacyShadowModule implements RiskModule {
  async evaluate(input: Parameters<RiskModule["evaluate"]>[0]): Promise<RiskModuleResult> {
    const approvalStatus = input.legacy_decision?.approval_status ?? "approved";
    const decision = approvalStatus === "rejected"
      ? "block"
      : approvalStatus === "approved_reduced"
        ? "modify"
        : "pass";
    return {
      module_name: "mirror_legacy_shadow",
      module_version: "1.0.0",
      decision,
      blocking_rules: (input.legacy_decision?.veto_reasons ?? []).map(rule => ({
        rule_code: String(rule).toLowerCase().replaceAll("_", "."),
        reason: String(rule),
      })),
      warnings: [],
      adjustments: [],
      metadata: {},
    };
  }
}

class AlwaysPassShadowModule implements RiskModule {
  async evaluate(): Promise<RiskModuleResult> {
    return {
      module_name: "always_pass_shadow",
      module_version: "1.0.0",
      decision: "pass",
      blocking_rules: [],
      warnings: [],
      adjustments: [],
      metadata: {},
    };
  }
}

function patchRiskShadowCreate(handler: (data: Record<string, unknown>) => Promise<unknown> | unknown) {
  const originalCreate = prisma.riskShadowLog.create;
  prisma.riskShadowLog.create = (async (args: { data: Record<string, unknown> }) => handler(args.data)) as unknown as typeof prisma.riskShadowLog.create;
  return () => {
    prisma.riskShadowLog.create = originalCreate;
  };
}

test("logs a RiskShadowLog record on each cycle evaluation", async () => {
  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);
  const engine = new RiskEngine(new LegacyRiskParityModule(governor), [new MirrorLegacyShadowModule()]);
  const captured: Record<string, unknown>[] = [];
  const restore = patchRiskShadowCreate(async data => {
    captured.push(data);
    return data;
  });

  try {
    await engine.evaluate({
      cycle_id: "cycle_log_1",
      candidate: makeIntent("EURUSD", 0.1),
      snapshot: makeSnapshot(),
      price: 1.1,
      repository,
      config,
      legacy_governor: governor,
      aggregated_pod_decision: null,
    });

    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.cycleId, "cycle_log_1");
    assert.equal(captured[0]?.symbol, "EURUSD");
  } finally {
    restore();
  }
});

test("matched=true when legacy and shadow decisions agree", async () => {
  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);
  const engine = new RiskEngine(new LegacyRiskParityModule(governor), [new MirrorLegacyShadowModule()]);
  const captured: Record<string, unknown>[] = [];
  const restore = patchRiskShadowCreate(async data => {
    captured.push(data);
    return data;
  });

  try {
    await engine.evaluate({
      cycle_id: "cycle_log_2",
      candidate: makeIntent("EURUSD", 0.1),
      snapshot: makeSnapshot(),
      price: 1.1,
      repository,
      config,
      legacy_governor: governor,
      aggregated_pod_decision: null,
    });

    assert.equal(captured[0]?.matched, true);
  } finally {
    restore();
  }
});

test("matched=false when legacy and shadow decisions disagree", async () => {
  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);
  const engine = new RiskEngine(new LegacyRiskParityModule(governor), [new AlwaysPassShadowModule()]);
  const captured: Record<string, unknown>[] = [];
  const restore = patchRiskShadowCreate(async data => {
    captured.push(data);
    return data;
  });

  try {
    await engine.evaluate({
      cycle_id: "cycle_log_3",
      candidate: makeIntent("GBPUSD", 0.1),
      snapshot: makeSnapshot("GBPUSD"),
      price: 1.27,
      repository,
      config,
      legacy_governor: governor,
      aggregated_pod_decision: null,
    });

    assert.equal(captured[0]?.matched, false);
  } finally {
    restore();
  }
});

test("divergentRules contains the rule codes that differ", async () => {
  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);
  const engine = new RiskEngine(new LegacyRiskParityModule(governor), [new AlwaysPassShadowModule()]);
  const captured: Record<string, unknown>[] = [];
  const restore = patchRiskShadowCreate(async data => {
    captured.push(data);
    return data;
  });

  try {
    await engine.evaluate({
      cycle_id: "cycle_log_4",
      candidate: makeIntent("GBPUSD", 0.1),
      snapshot: makeSnapshot("GBPUSD"),
      price: 1.27,
      repository,
      config,
      legacy_governor: governor,
      aggregated_pod_decision: null,
    });

    const divergentRules = JSON.parse(String(captured[0]?.divergentRules ?? "[]")) as string[];
    assert.ok(divergentRules.length > 0);
  } finally {
    restore();
  }
});

test("shadow log failure does not crash the cycle", async () => {
  const repository = new ApexRepository();
  const governor = new RiskGovernor(repository, config);
  const engine = new RiskEngine(new LegacyRiskParityModule(governor), [new MirrorLegacyShadowModule()]);
  const restore = patchRiskShadowCreate(async () => {
    throw new Error("shadow log write failed");
  });

  try {
    const result = await engine.evaluate({
      cycle_id: "cycle_log_5",
      candidate: makeIntent("EURUSD", 0.1),
      snapshot: makeSnapshot(),
      price: 1.1,
      repository,
      config,
      legacy_governor: governor,
      aggregated_pod_decision: null,
    });

    assert.equal(result.authoritative_source, "legacy_risk_parity");
  } finally {
    restore();
  }
});
