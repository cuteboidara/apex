import type { RiskDecision } from "@/src/interfaces/contracts";
import type { RiskGovernor } from "@/src/risk/RiskGovernor";
import { deriveLegacyRiskFacts } from "@/src/domain/risk/legacyRiskMapping";
import type { RiskEvaluationInput, RiskModule, RiskModuleResult } from "@/src/domain/risk/types";

export class LegacyRiskParityModule implements RiskModule {
  constructor(private readonly governor: RiskGovernor) {}

  evaluateLegacy(input: RiskEvaluationInput): {
    legacy_decision: RiskDecision;
    result: RiskModuleResult;
    blocking_rule_codes: string[];
    warning_codes: string[];
    adjustments: ReturnType<typeof deriveLegacyRiskFacts>["adjustments"];
    size_adjustments: ReturnType<typeof deriveLegacyRiskFacts>["size_adjustments"];
    canonical_decision: ReturnType<typeof deriveLegacyRiskFacts>["canonical_decision"];
  } {
    const legacyDecision = input.legacy_decision ?? this.governor.evaluate({
      intent: input.candidate,
      snapshot: input.snapshot,
      price: input.price,
    });
    const mapped = deriveLegacyRiskFacts(input, legacyDecision);

    return {
      legacy_decision: legacyDecision,
      result: mapped.authoritative_result,
      blocking_rule_codes: mapped.blocking_rules.map(rule => rule.rule_code),
      warning_codes: mapped.warnings.map(warning => warning.warning_code),
      adjustments: mapped.adjustments,
      size_adjustments: mapped.size_adjustments,
      canonical_decision: mapped.canonical_decision,
    };
  }

  async evaluate(input: RiskEvaluationInput): Promise<RiskModuleResult> {
    return this.evaluateLegacy(input).result;
  }
}
