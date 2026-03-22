import { deleteCachedValue, getCachedValue, setCachedValue } from "@/lib/runtime/runtimeCache";
import type { LlmProvider } from "@/lib/llm/types";

type ProviderCooldown = {
  provider: LlmProvider;
  reason: string;
  until: number;
};

const RATE_LIMIT_COOLDOWN_MS = Number.parseInt(process.env.APEX_LLM_RATE_LIMIT_COOLDOWN_MS ?? "", 10) || 30 * 60_000;
const QUOTA_COOLDOWN_MS = Number.parseInt(process.env.APEX_LLM_QUOTA_COOLDOWN_MS ?? "", 10) || 60 * 60_000;
const TEMP_FAILURE_COOLDOWN_MS = Number.parseInt(process.env.APEX_LLM_TEMP_FAILURE_COOLDOWN_MS ?? "", 10) || 10 * 60_000;
const CONFIG_COOLDOWN_MS = Number.parseInt(process.env.APEX_LLM_CONFIG_COOLDOWN_MS ?? "", 10) || 30 * 60_000;
const EMPTY_RESPONSE_COOLDOWN_MS = Number.parseInt(process.env.APEX_LLM_EMPTY_RESPONSE_COOLDOWN_MS ?? "", 10) || 5 * 60_000;

function cooldownKey(provider: LlmProvider) {
  return `llm:cooldown:${provider}`;
}

export function classifyLlmFailure(error: unknown) {
  const reason = String(error ?? "unknown_error").trim();
  const normalized = reason.toLowerCase();

  if (
    normalized.includes("insufficient_quota") ||
    normalized.includes("credit balance is too low") ||
    normalized.includes("quota") ||
    normalized.includes("resource exhausted")
  ) {
    return { reason, cooldownMs: QUOTA_COOLDOWN_MS };
  }

  if (normalized.includes("429") || normalized.includes("rate limit")) {
    return { reason, cooldownMs: RATE_LIMIT_COOLDOWN_MS };
  }

  if (
    normalized.includes("missing_api_key") ||
    normalized.includes("api key not valid") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden")
  ) {
    return { reason, cooldownMs: CONFIG_COOLDOWN_MS };
  }

  if (normalized.includes("empty_response")) {
    return { reason, cooldownMs: EMPTY_RESPONSE_COOLDOWN_MS };
  }

  return { reason, cooldownMs: TEMP_FAILURE_COOLDOWN_MS };
}

export async function getProviderCooldown(provider: LlmProvider): Promise<ProviderCooldown | null> {
  const cooldown = await getCachedValue<ProviderCooldown>(cooldownKey(provider));
  if (!cooldown) return null;
  if (cooldown.until <= Date.now()) {
    await deleteCachedValue(cooldownKey(provider));
    return null;
  }
  return cooldown;
}

export async function setProviderCooldown(provider: LlmProvider, reason: string, cooldownMs: number) {
  const until = Date.now() + Math.max(1_000, cooldownMs);
  await setCachedValue(cooldownKey(provider), {
    provider,
    reason,
    until,
  } satisfies ProviderCooldown, cooldownMs);
}

export async function clearProviderCooldown(provider: LlmProvider) {
  await deleteCachedValue(cooldownKey(provider));
}
