import type {
  CanonicalRiskDecision,
  RiskAdjustment,
  RiskModuleResult,
  RiskRule,
  RiskWarning,
} from "@/src/domain/risk/types";
import { LEGACY_VETO_RULE_CODE_MAP, LEGACY_WARNING_RULE_CODE_MAP, RISK_CHECK_RULE_CODE_MAP } from "@/src/domain/risk/ruleCatalog";
import type { RiskEvaluationInput } from "@/src/domain/risk/types";
import type { NoTradeReasonCode, RiskDecision } from "@/src/interfaces/contracts";

function dedupeByCode<T extends { rule_code?: string; warning_code?: string; adjustment_code?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.rule_code ?? item.warning_code ?? item.adjustment_code ?? JSON.stringify(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function mapLegacyApprovalStatus(decision: RiskDecision["approval_status"]): CanonicalRiskDecision {
  if (decision === "approved") {
    return "approved";
  }
  if (decision === "approved_reduced") {
    return "modified";
  }
  return "blocked";
}

function reasonForRuleCode(ruleCode: string): string {
  return ruleCode.replaceAll(".", " ");
}

function mapLegacyReason(code: NoTradeReasonCode): RiskRule {
  const ruleCode = LEGACY_VETO_RULE_CODE_MAP[code] ?? `legacy.${code.toLowerCase()}`;
  return {
    rule_code: ruleCode,
    reason: reasonForRuleCode(ruleCode),
    metadata: {
      legacy_reason_code: code,
    },
  };
}

function mapLegacyWarning(code: NoTradeReasonCode): RiskWarning {
  const warningCode = LEGACY_WARNING_RULE_CODE_MAP[code] ?? LEGACY_VETO_RULE_CODE_MAP[code] ?? `legacy.${code.toLowerCase()}`;
  return {
    warning_code: warningCode,
    reason: reasonForRuleCode(warningCode),
    metadata: {
      legacy_warning_code: code,
    },
  };
}

function mapRiskCheckFailures(input: RiskEvaluationInput, decision: RiskDecision): RiskRule[] {
  return Object.entries(decision.risk_check_results ?? {})
    .filter(([, passed]) => !passed)
    .map(([check, passed]) => {
      const ruleCode = RISK_CHECK_RULE_CODE_MAP[check as keyof RiskDecision["risk_check_results"]] ?? `legacy_check.${check}`;
      return {
        rule_code: ruleCode,
        reason: reasonForRuleCode(ruleCode),
        metadata: {
          check,
          passed,
          symbol: input.candidate.symbol_canonical,
        },
      };
    });
}

export function deriveLegacyRiskFacts(input: RiskEvaluationInput, decision: RiskDecision): {
  canonical_decision: CanonicalRiskDecision;
  blocking_rules: RiskRule[];
  warnings: RiskWarning[];
  adjustments: RiskAdjustment[];
  authoritative_result: RiskModuleResult;
  size_adjustments: {
    original_size: number;
    approved_size: number;
    approved_size_multiplier: number;
  } | null;
} {
  const vetoReasons = decision.veto_reasons ?? [];
  const warningReasons = decision.warning_reasons ?? [];
  const canonicalDecision = mapLegacyApprovalStatus(decision.approval_status);
  const blockingRules = dedupeByCode([
    ...mapRiskCheckFailures(input, decision),
    ...vetoReasons.map(reason => mapLegacyReason(reason)),
    ...(decision.kill_switch_active ? [{
      rule_code: "policy.kill_switch_active",
      reason: "policy kill switch active",
      metadata: {
        kill_switch_active: true,
      },
    }] : []),
  ]);

  const warnings = dedupeByCode(warningReasons.map(reason => mapLegacyWarning(reason)));
  const originalSize = Math.abs(input.candidate.target_position);
  const approvedMultiplier = decision.approved_size_multiplier ?? 1;
  const approvedSize = originalSize * approvedMultiplier;
  const adjustments: RiskAdjustment[] = decision.approval_status === "approved_reduced"
    ? [{
      adjustment_code: "portfolio.size_multiplier_reduced",
      field: "approved_size_multiplier",
      before: 1,
      after: approvedMultiplier,
      reason: "legacy risk governor reduced the approved size multiplier",
      metadata: {
        de_risking_action: decision.de_risking_action ?? "partial_flatten",
      },
    }]
    : [];

  return {
    canonical_decision: canonicalDecision,
    blocking_rules: blockingRules,
    warnings,
    adjustments,
    authoritative_result: {
      module_name: "legacy_risk_parity",
      module_version: "1.0.0",
      decision: canonicalDecision === "blocked" ? "block" : canonicalDecision === "modified" ? "modify" : "pass",
      blocking_rules: blockingRules,
      warnings,
      adjustments,
      metadata: {
        authoritative: true,
        risk_check_results: decision.risk_check_results ?? {},
        legacy_approval_status: decision.approval_status,
        legacy_veto_reasons: vetoReasons,
        legacy_warning_reasons: warningReasons,
        kill_switch_active: decision.kill_switch_active,
        override_instructions: decision.override_instructions ?? null,
        de_risking_action: decision.de_risking_action ?? "none",
      },
    },
    size_adjustments: canonicalDecision === "modified" || approvedMultiplier !== 1
      ? {
        original_size: originalSize,
        approved_size: approvedSize,
        approved_size_multiplier: approvedMultiplier,
      }
      : null,
  };
}

export function filterRulesByPrefix(rules: RiskRule[], prefixes: string[]): RiskRule[] {
  return rules.filter(rule => prefixes.some(prefix => rule.rule_code.startsWith(prefix)));
}

export function filterWarningsByPrefix(warnings: RiskWarning[], prefixes: string[]): RiskWarning[] {
  return warnings.filter(warning => prefixes.some(prefix => warning.warning_code.startsWith(prefix)));
}

export function filterAdjustmentsByPrefix(adjustments: RiskAdjustment[], prefixes: string[]): RiskAdjustment[] {
  return adjustments.filter(adjustment => prefixes.some(prefix => adjustment.adjustment_code.startsWith(prefix)));
}
