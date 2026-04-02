import { deriveLegacyRiskFacts, filterAdjustmentsByPrefix, filterRulesByPrefix, filterWarningsByPrefix } from "@/src/domain/risk/legacyRiskMapping";
import type { RiskEvaluationInput, RiskModule, RiskModuleResult } from "@/src/domain/risk/types";

export class PolicyRulesRiskModule implements RiskModule {
  async evaluate(input: RiskEvaluationInput): Promise<RiskModuleResult> {
    const legacyFacts = deriveLegacyRiskFacts(
      input,
      input.legacy_decision ?? input.legacy_governor.evaluate({
        intent: input.candidate,
        snapshot: input.snapshot,
        price: input.price,
      }),
    );
    const prefixes = ["policy."];
    const blockingRules = filterRulesByPrefix(legacyFacts.blocking_rules, prefixes);
    const warnings = filterWarningsByPrefix(legacyFacts.warnings, prefixes);
    const adjustments = filterAdjustmentsByPrefix(legacyFacts.adjustments, prefixes);

    return {
      module_name: "policy_rules_risk",
      module_version: "1.0.0",
      decision: blockingRules.length > 0 ? "block" : adjustments.length > 0 ? "modify" : "pass",
      blocking_rules: blockingRules,
      warnings,
      adjustments,
      metadata: {
        shadow: true,
        active_symbols: input.config.activeSymbols,
        kill_switch_active: input.repository.isKillSwitchActive(),
      },
    };
  }
}
