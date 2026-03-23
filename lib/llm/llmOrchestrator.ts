import { generateAnthropicText } from "@/lib/llm/anthropic";
import { generateOpenAiText } from "@/lib/llm/openai";
import { generateGeminiText } from "@/lib/llm/gemini";
import { classifyLlmFailure, clearProviderCooldown, getProviderCooldown, setProviderCooldown } from "@/lib/llm/providerCooldown";
import type { LlmOrchestratorResponse, LlmPromptInput, LlmProvider } from "@/lib/llm/types";

const EXPLANATION_UNAVAILABLE = "Explanation unavailable";

const PROVIDER_CHAIN: Array<{
  provider: LlmProvider;
  envKey: string;
  generate: (input: LlmPromptInput) => Promise<{ text: string; provider: LlmProvider }>;
}> = [
  { provider: "anthropic", envKey: "ANTHROPIC_API_KEY", generate: generateAnthropicText },
  { provider: "openai",    envKey: "OPENAI_API_KEY",    generate: generateOpenAiText    },
  { provider: "gemini",    envKey: "GEMINI_API_KEY",    generate: generateGeminiText    },
];

export async function generateLlmText(input: LlmPromptInput): Promise<LlmOrchestratorResponse> {
  const chain: LlmOrchestratorResponse["chain"] = [];

  for (const [index, candidate] of PROVIDER_CHAIN.entries()) {
    // Skip cleanly if API key is not configured — no cooldown, no health error.
    if (!process.env[candidate.envKey]) {
      console.log(`[APEX:llm] ${candidate.provider} key missing (${candidate.envKey}) — skipping`);
      chain.push({
        provider: candidate.provider,
        status: "skipped",
        reason: "missing_api_key",
      });
      continue;
    }

    const cooldown = await getProviderCooldown(candidate.provider);
    if (cooldown) {
      chain.push({
        provider: candidate.provider,
        status: "skipped",
        reason: `cooldown:${new Date(cooldown.until).toISOString()}:${cooldown.reason}`,
      });
      continue;
    }

    try {
      const result = await candidate.generate(input);
      if (result.text.trim()) {
        await clearProviderCooldown(candidate.provider);
        chain.push({
          provider: candidate.provider,
          status: "success",
          reason: null,
        });
        return {
          ...result,
          fallbackUsed: index > 0,
          status: "generated",
          degradedReason: index > 0 ? "fallback_provider_used" : null,
          chain,
        };
      }
      const classified = classifyLlmFailure("empty_response");
      await setProviderCooldown(candidate.provider, classified.reason, classified.cooldownMs);
      chain.push({
        provider: candidate.provider,
        status: "failed",
        reason: classified.reason,
      });
    } catch (error) {
      // Missing-key errors are configuration issues, not runtime failures — skip cleanly.
      if ((error as { skipHealthRecord?: boolean }).skipHealthRecord) {
        chain.push({ provider: candidate.provider, status: "skipped", reason: "missing_api_key" });
        continue;
      }
      const classified = classifyLlmFailure(error);
      await setProviderCooldown(candidate.provider, classified.reason, classified.cooldownMs);
      chain.push({
        provider: candidate.provider,
        status: "failed",
        reason: classified.reason,
      });
    }
  }

  return {
    text: EXPLANATION_UNAVAILABLE,
    provider: "none",
    fallbackUsed: true,
    status: "unavailable",
    degradedReason: chain.some(item => item.status === "skipped") ? "providers_on_cooldown" : "all_providers_failed",
    chain,
  };
}
