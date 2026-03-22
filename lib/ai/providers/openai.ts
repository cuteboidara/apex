const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 20_000;

/**
 * Lightweight GPT-4o caller for the 3-stage AI analysis pipeline.
 * Uses the standard Chat Completions API (not the Responses API used by llmOrchestrator).
 */
export async function callGPT4(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(OPENAI_CHAT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) return null;

    const data = await response.json().catch(() => null) as {
      choices?: Array<{ message?: { content?: string } }>;
    } | null;

    return data?.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}
