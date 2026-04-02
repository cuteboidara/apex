import type { AggregatedPodDecision } from "@/src/domain/pods/types";
import type { AllocationIntent, FeatureSnapshot, RiskDecision } from "@/src/interfaces/contracts";
import type { RiskGovernor } from "@/src/risk/RiskGovernor";

export type RiskModuleDecision = "pass" | "block" | "modify";
export type CanonicalRiskDecision = "approved" | "blocked" | "modified";

export type RiskRule = {
  rule_code: string;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type RiskWarning = {
  warning_code: string;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type RiskAdjustment = {
  adjustment_code: string;
  field: string;
  before: unknown;
  after: unknown;
  reason: string;
  metadata?: Record<string, unknown>;
};

export type RiskModuleResult = {
  module_name: string;
  module_version: string;
  decision: RiskModuleDecision;
  blocking_rules: RiskRule[];
  warnings: RiskWarning[];
  adjustments: RiskAdjustment[];
  metadata: Record<string, unknown>;
};

export type RiskEvaluationInput = {
  cycle_id: string;
  candidate: AllocationIntent;
  snapshot: FeatureSnapshot;
  price: number;
  repository: {
    isKillSwitchActive(): boolean;
    appendRiskShadowLog(input: {
      cycleId: string;
      symbol: string;
      legacyDecision: string;
      shadowDecision: string;
      matched: boolean;
      divergentRules: string;
      legacyRuleCodes: string;
      shadowRuleCodes: string;
    }): Promise<void>;
  };
  config: {
    activeSymbols: string[];
  };
  legacy_governor: RiskGovernor;
  aggregated_pod_decision: AggregatedPodDecision | null;
  legacy_decision?: RiskDecision;
};

export interface RiskModule {
  evaluate(input: RiskEvaluationInput): Promise<RiskModuleResult>;
}

export type RiskEngineEvaluation = {
  legacy_decision: RiskDecision;
  decision: CanonicalRiskDecision;
  blocking_rules: string[];
  warnings: string[];
  size_adjustments: {
    original_size: number;
    approved_size: number;
    approved_size_multiplier: number;
  } | null;
  policy_evaluations: RiskModuleResult[];
  risk_version: string;
  approved_trade_plan: AllocationIntent["trade_plan"] | null;
  authoritative_source: string;
  shadow_decision: CanonicalRiskDecision | null;
  shadow_mismatch: boolean;
  shadow_blocking_rules: string[];
  shadow_adjustments: RiskAdjustment[];
  explainability_score: number | null;
};
