import { aggregateRiskResults } from "@/src/domain/risk/aggregateRiskResults";
import { LegacyRiskParityModule } from "@/src/domain/risk/modules/LegacyRiskParityModule";
import type {
  RiskEngineEvaluation,
  RiskEvaluationInput,
  RiskModule,
  RiskModuleResult,
} from "@/src/domain/risk/types";

// PHASE 5 NOTE: Shadow mismatch rate was above 5% at Phase 5 execution time.
// LegacyRiskParityModule remains the live authority until mismatch drops below 5%.
// Check /admin/risk-shadow to monitor. Promote when safeToPromote: true.

function explainabilityScore(results: RiskModuleResult[]): number | null {
  const total = results.length;
  if (total === 0) {
    return null;
  }

  const withStructuredOutput = results.filter(result =>
    result.blocking_rules.length > 0 || result.warnings.length > 0 || result.adjustments.length > 0,
  ).length;
  return Math.round((withStructuredOutput / total) * 100) / 100;
}

export class RiskEngine {
  constructor(
    private readonly legacyModule: LegacyRiskParityModule,
    private readonly shadowModules: RiskModule[],
  ) {}

  async evaluate(input: RiskEvaluationInput): Promise<RiskEngineEvaluation> {
    const legacy = this.legacyModule.evaluateLegacy(input);
    const shadowInput: RiskEvaluationInput = {
      ...input,
      legacy_decision: legacy.legacy_decision,
    };

    const shadowResults = await Promise.all(this.shadowModules.map(module => module.evaluate(shadowInput)));
    const shadowAggregate = aggregateRiskResults(shadowResults);
    const policyEvaluations = [...shadowResults, legacy.result];
    const shadowBlockingRuleCodes = [...new Set(shadowAggregate.blocking_rules.map(rule => rule.rule_code))];
    const authoritativeBlockingRuleCodes = [...new Set(legacy.blocking_rule_codes)];
    const shadowMismatch = shadowAggregate.decision !== legacy.canonical_decision
      || shadowBlockingRuleCodes.join("|") !== authoritativeBlockingRuleCodes.join("|");

    for (const result of policyEvaluations) {
      console.info({
        module: "risk-engine",
        message: "Risk module evaluated",
        cycle_id: input.cycle_id,
        symbol: input.candidate.symbol_canonical,
        candidate_id: input.candidate.candidate_id,
        module_name: result.module_name,
        decision: result.decision,
        risk_module_decision_count: 1,
      });
      for (const rule of result.blocking_rules) {
        console.warn({
          module: "risk-engine",
          message: "Risk rule blocked candidate",
          cycle_id: input.cycle_id,
          symbol: input.candidate.symbol_canonical,
          candidate_id: input.candidate.candidate_id,
          module_name: result.module_name,
          rule_code: rule.rule_code,
          risk_rule_block_count: 1,
        });
      }
      for (const warning of result.warnings) {
        console.info({
          module: "risk-engine",
          message: "Risk warning recorded",
          cycle_id: input.cycle_id,
          symbol: input.candidate.symbol_canonical,
          candidate_id: input.candidate.candidate_id,
          module_name: result.module_name,
          rule_code: warning.warning_code,
          risk_rule_warning_count: 1,
        });
      }
    }

    if (shadowMismatch) {
      console.warn("[risk-engine] Shadow risk mismatch detected risk_shadow_mismatch_count=1", {
        module: "risk-engine",
        message: "Shadow risk mismatch detected",
        cycle_id: input.cycle_id,
        symbol: input.candidate.symbol_canonical,
        candidate_id: input.candidate.candidate_id,
        authoritative_source: "legacy_risk_parity",
        authoritative_decision: legacy.canonical_decision,
        shadow_decision: shadowAggregate.decision,
        authoritative_blocking_rules: authoritativeBlockingRuleCodes,
        shadow_blocking_rules: shadowBlockingRuleCodes,
        risk_shadow_mismatch_count: 1,
      });
    }

    try {
      await input.repository.appendRiskShadowLog({
        cycleId: input.cycle_id,
        symbol: input.candidate.symbol_canonical,
        legacyDecision: legacy.canonical_decision,
        shadowDecision: shadowAggregate.decision,
        matched: !shadowMismatch,
        divergentRules: JSON.stringify(findDivergentRules(authoritativeBlockingRuleCodes, shadowBlockingRuleCodes)),
        legacyRuleCodes: JSON.stringify(authoritativeBlockingRuleCodes),
        shadowRuleCodes: JSON.stringify(shadowBlockingRuleCodes),
      });
    } catch (error) {
      console.warn({
        module: "risk-engine",
        message: "Failed to persist risk shadow log",
        cycle_id: input.cycle_id,
        symbol: input.candidate.symbol_canonical,
        error: String(error),
      });
    }

    return {
      legacy_decision: legacy.legacy_decision,
      decision: legacy.canonical_decision,
      blocking_rules: authoritativeBlockingRuleCodes,
      warnings: legacy.warning_codes,
      size_adjustments: legacy.size_adjustments,
      policy_evaluations: policyEvaluations,
      risk_version: "risk_engine_v2",
      approved_trade_plan: legacy.canonical_decision === "blocked" ? null : input.candidate.trade_plan,
      authoritative_source: "legacy_risk_parity",
      shadow_decision: shadowAggregate.decision,
      shadow_mismatch: shadowMismatch,
      shadow_blocking_rules: shadowBlockingRuleCodes,
      shadow_adjustments: shadowAggregate.adjustments,
      explainability_score: explainabilityScore(policyEvaluations),
    };
  }
}

function findDivergentRules(legacyRuleCodes: string[], shadowRuleCodes: string[]): string[] {
  const legacy = new Set(legacyRuleCodes);
  const shadow = new Set(shadowRuleCodes);
  return [...new Set([...legacyRuleCodes, ...shadowRuleCodes])].filter(rule =>
    legacy.has(rule) !== shadow.has(rule),
  );
}
