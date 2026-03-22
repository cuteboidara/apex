const TIMEOUT_MS = 20_000;

/**
 * Lightweight Gemini caller for the 3-stage AI analysis pipeline.
 * Sends a single-turn prompt (no system/user split — Gemini 1.5 Flash preferred).
 */
export async function callGemini(prompt: string): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const model   = "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) return null;

    const data = await response.json().catch(() => null) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;

    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch {
    return null;
  }
}
