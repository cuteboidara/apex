import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("[apex-llm] ANTHROPIC_API_KEY is not set");
  }

  if (!client) {
    client = new Anthropic({ apiKey });
  }

  return client;
}

export const APEX_LLM_MODEL = "claude-sonnet-4-20250514";
export const APEX_LLM_MAX_TOKENS = 800;
