import { createHash } from "node:crypto";
import { getLlmRuntimePolicy } from "@/lib/llm/config";
import { getCachedExplanationRecord, storeExplanationRecord } from "@/lib/llm/explanationCache";
import { generateLlmText } from "@/lib/llm/llmOrchestrator";
import {
  buildInsightsTemplate,
  buildLifecycleOutcomeTemplate,
  buildReasoningTemplate,
  buildSignalNarrativeTemplate,
  type InsightsTemplateTrade,
  type LifecycleTemplateInput,
  type ReasoningTemplateInput,
  type SignalNarrativeTemplateInput,
} from "@/lib/llm/templates";
import type {
  CachedExplanationRecord,
  ExplanationRequestMode,
  ExplanationResponse,
  LlmAttempt,
  LlmPromptInput,
  LlmPurpose,
} from "@/lib/llm/types";

const EXPLANATION_UNAVAILABLE = "Explanation unavailable";
const inflight = new Map<string, Promise<ExplanationResponse>>();

function readFeatureFlag(key: string, fallback: boolean) {
  const raw = process.env[key];
  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  return !["0", "false", "off"].includes(raw.trim().toLowerCase());
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(item => stableSerialize(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`).join(",")}}`;
}

export function createExplanationFingerprint(input: {
  purpose: LlmPurpose;
  payload: Record<string, unknown>;
}) {
  const hash = createHash("sha256");
  hash.update(input.purpose);
  hash.update(":");
  hash.update(stableSerialize(input.payload));
  return hash.digest("hex");
}

function toExplanationResponse(record: CachedExplanationRecord, cached: boolean): ExplanationResponse {
  return {
    text: record.content,
    provider: record.provider,
    fallbackUsed: record.fallbackUsed,
    status: record.status,
    degradedReason: record.errorMetadata?.degradedReason ?? null,
    fingerprint: record.fingerprint,
    cached,
    generatedAt: record.generatedAt,
    chain: record.fallbackChain,
  };
}

function externalAllowed(mode: ExplanationRequestMode, eligibleForAuto: boolean) {
  if (getLlmRuntimePolicy().disabled) {
    return false;
  }

  const autoLlmForPublished = readFeatureFlag("APEX_ENABLE_AUTO_LLM_PUBLISHED", true);
  const explicitLlmEnabled = readFeatureFlag("APEX_ENABLE_EXPLICIT_LLM", true);

  if (mode === "explicit") {
    return explicitLlmEnabled;
  }

  return eligibleForAuto && autoLlmForPublished;
}

async function finalizeExplanation(input: {
  purpose: LlmPurpose;
  fingerprint: string;
  generated: {
    text: string;
    provider: ExplanationResponse["provider"];
    fallbackUsed: boolean;
    status: ExplanationResponse["status"];
    degradedReason: string | null;
    chain: LlmAttempt[];
  };
}) {
  const generatedAt = new Date().toISOString();
  const record: CachedExplanationRecord = {
    fingerprint: input.fingerprint,
    purpose: input.purpose,
    status: input.generated.status,
    provider: input.generated.provider,
    fallbackUsed: input.generated.fallbackUsed,
    fallbackChain: input.generated.chain,
    content: input.generated.text,
    errorMetadata: {
      degradedReason: input.generated.degradedReason,
    },
    generatedAt,
  };

  await storeExplanationRecord(record);
  return toExplanationResponse(record, false);
}

async function withInflightDedup(key: string, factory: () => Promise<ExplanationResponse>) {
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }

  const promise = factory().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

async function resolveExplanation(input: {
  purpose: LlmPurpose;
  mode: ExplanationRequestMode;
  eligibleForAuto: boolean;
  fingerprintPayload: Record<string, unknown>;
  prompt: LlmPromptInput;
  templateText: string | null;
}) {
  const fingerprint = createExplanationFingerprint({
    purpose: input.purpose,
    payload: input.fingerprintPayload,
  });
  const inflightKey = `${input.purpose}:${fingerprint}`;

  return withInflightDedup(inflightKey, async () => {
    const cached = await getCachedExplanationRecord(fingerprint, input.purpose);
    if (cached) {
      return toExplanationResponse(cached, true);
    }

    const canCallExternal = externalAllowed(input.mode, input.eligibleForAuto);
    if (!canCallExternal) {
      const llmPolicy = getLlmRuntimePolicy();
      if (input.templateText) {
        return finalizeExplanation({
          purpose: input.purpose,
          fingerprint,
          generated: {
            text: input.templateText,
            provider: "none",
            fallbackUsed: false,
            status: "template",
            degradedReason: llmPolicy.disabled
              ? "llm_disabled"
              : input.mode === "explicit"
                ? "llm_disabled"
                : "template_only_mode",
            chain: [],
          },
        });
      }

      return finalizeExplanation({
        purpose: input.purpose,
        fingerprint,
        generated: {
          text: EXPLANATION_UNAVAILABLE,
          provider: "none",
          fallbackUsed: false,
          status: "unavailable",
          degradedReason: llmPolicy.disabled ? "llm_disabled" : "not_eligible",
          chain: [],
        },
      });
    }

    const llm = await generateLlmText({
      ...input.prompt,
      fingerprint,
    });

    if (llm.status === "generated" && llm.text.trim()) {
      return finalizeExplanation({
        purpose: input.purpose,
        fingerprint,
        generated: {
          text: llm.text,
          provider: llm.provider,
          fallbackUsed: llm.fallbackUsed,
          status: "generated",
          degradedReason: llm.degradedReason,
          chain: llm.chain,
        },
      });
    }

    if (input.templateText) {
      return finalizeExplanation({
        purpose: input.purpose,
        fingerprint,
        generated: {
          text: input.templateText,
          provider: "none",
          fallbackUsed: llm.fallbackUsed || llm.chain.length > 0,
          status: "template",
          degradedReason: llm.degradedReason ?? "template_fallback",
          chain: llm.chain,
        },
      });
    }

    return finalizeExplanation({
      purpose: input.purpose,
      fingerprint,
      generated: {
        text: EXPLANATION_UNAVAILABLE,
        provider: "none",
        fallbackUsed: llm.fallbackUsed || llm.chain.length > 0,
        status: "unavailable",
        degradedReason: llm.degradedReason ?? "all_providers_failed",
        chain: llm.chain,
      },
    });
  });
}

export async function generateSignalNarrative(input: {
  template: SignalNarrativeTemplateInput;
  prompt: Omit<LlmPromptInput, "purpose" | "fingerprint">;
  mode?: ExplanationRequestMode;
}) {
  return resolveExplanation({
    purpose: "narrative",
    mode: input.mode ?? "auto",
    eligibleForAuto: input.template.status === "ACTIVE",
    fingerprintPayload: {
      symbol: input.template.symbol,
      assetClass: input.template.assetClass,
      direction: input.template.direction,
      rank: input.template.rank,
      style: input.template.style,
      setupFamily: input.template.setupFamily,
      regimeTag: input.template.regimeTag,
      status: input.template.status,
      diagnostics: input.template.diagnostics,
      entry: input.template.entry,
      stopLoss: input.template.stopLoss,
      tp1: input.template.tp1,
      tp2: input.template.tp2,
      tp3: input.template.tp3,
      freshnessClass: input.template.freshnessClass,
      marketStatus: input.template.marketStatus,
      provider: input.template.provider,
      providerHealthState: input.template.providerHealthState,
      fallbackUsed: input.template.fallbackUsed,
      reason: input.template.reason,
    },
    prompt: {
      ...input.prompt,
      purpose: "narrative",
    },
    templateText: buildSignalNarrativeTemplate(input.template),
  });
}

export async function generateReasoningExplanation(input: {
  template: ReasoningTemplateInput;
  prompt: Omit<LlmPromptInput, "purpose" | "fingerprint">;
  mode?: ExplanationRequestMode;
}) {
  return resolveExplanation({
    purpose: "reasoning",
    mode: input.mode ?? "explicit",
    eligibleForAuto: false,
    fingerprintPayload: input.template,
    prompt: {
      ...input.prompt,
      purpose: "reasoning",
    },
    templateText: buildReasoningTemplate(input.template),
  });
}

export async function generateInsightsExplanation(input: {
  trades: InsightsTemplateTrade[];
  prompt: Omit<LlmPromptInput, "purpose" | "fingerprint">;
  mode?: ExplanationRequestMode;
}) {
  return resolveExplanation({
    purpose: "insights",
    mode: input.mode ?? "explicit",
    eligibleForAuto: false,
    fingerprintPayload: {
      trades: input.trades.map(trade => ({
        asset: trade.asset,
        direction: trade.direction,
        rank: trade.rank,
        total: trade.total,
        outcome: trade.outcome,
        pnl: trade.pnl,
      })),
    },
    prompt: {
      ...input.prompt,
      purpose: "insights",
    },
    templateText: buildInsightsTemplate(input.trades),
  });
}

export async function generateLifecycleExplanation(input: {
  template: LifecycleTemplateInput;
  prompt: Omit<LlmPromptInput, "purpose" | "fingerprint">;
  mode?: ExplanationRequestMode;
}) {
  return resolveExplanation({
    purpose: "lifecycle",
    mode: input.mode ?? "auto",
    eligibleForAuto: Boolean(input.template.outcome && input.template.outcome !== "PENDING_ENTRY"),
    fingerprintPayload: input.template,
    prompt: {
      ...input.prompt,
      purpose: "lifecycle",
    },
    templateText: buildLifecycleOutcomeTemplate(input.template),
  });
}
