import Anthropic from "@anthropic-ai/sdk";
import { formatLlmError, recordLlmFailure, recordLlmSuccess, sanitizeLlmText } from "@/lib/llm/shared";
import type { LlmPromptInput, LlmProviderResponse } from "@/lib/llm/types";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_LLM_MODEL ?? "claude-sonnet-4-6";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function generateAnthropicText(input: LlmPromptInput): Promise<LlmProviderResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("missing_api_key");
  }

  const startedAt = Date.now();
  try {
    const message = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: input.maxTokens,
      system: input.system,
      messages: [{ role: "user", content: input.user }],
    });
    const text = sanitizeLlmText(
      message.content
        .filter(block => block.type === "text")
        .map(block => block.text)
        .join("\n")
    );

    if (!text) {
      throw new Error("empty_response");
    }

    await recordLlmSuccess("Anthropic", input, Date.now() - startedAt, "ok");
    return { text, provider: "anthropic" };
  } catch (error) {
    await recordLlmFailure("Anthropic", input, Date.now() - startedAt, formatLlmError(error));
    throw error;
  }
}
