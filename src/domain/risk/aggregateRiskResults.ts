import type {
  CanonicalRiskDecision,
  RiskAdjustment,
  RiskModuleResult,
  RiskRule,
} from "@/src/domain/risk/types";

export function aggregateRiskResults(results: RiskModuleResult[]): {
  decision: CanonicalRiskDecision;
  blocking_rules: RiskRule[];
  warnings: string[];
  adjustments: RiskAdjustment[];
} {
  const blockingRules = results.flatMap(result => result.blocking_rules);
  const adjustments = results.flatMap(result => result.adjustments);
  const warnings = [...new Set(results.flatMap(result => result.warnings.map(warning => warning.warning_code)))];

  if (blockingRules.length > 0 || results.some(result => result.decision === "block")) {
    return {
      decision: "blocked",
      blocking_rules: blockingRules,
      warnings,
      adjustments,
    };
  }

  if (adjustments.length > 0 || results.some(result => result.decision === "modify")) {
    return {
      decision: "modified",
      blocking_rules: blockingRules,
      warnings,
      adjustments,
    };
  }

  return {
    decision: "approved",
    blocking_rules: blockingRules,
    warnings,
    adjustments,
  };
}
