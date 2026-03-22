import { anthropic } from "@/lib/llm/anthropic";

const TIMEOUT_MS = 20_000;
const MODEL      = process.env.ANTHROPIC_LLM_MODEL ?? "claude-sonnet-4-6";

/**
 * Lightweight Claude caller for the 3-stage AI analysis pipeline.
 * Reuses the existing singleton Anthropic client.
 */
export async function callClaude(systemPrompt: string, userPrompt: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const message = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: 500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      },
      { timeout: TIMEOUT_MS },
    );

    const text = message.content
      .filter(block => block.type === "text")
      .map(block => block.text)
      .join("\n")
      .trim();

    return text || null;
  } catch {
    return null;
  }
}
