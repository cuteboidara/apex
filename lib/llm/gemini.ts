import { formatLlmError, LLM_REQUEST_TIMEOUT_MS, recordLlmFailure, recordLlmSuccess, sanitizeLlmText } from "@/lib/llm/shared";
import type { LlmPromptInput, LlmProviderResponse } from "@/lib/llm/types";

const GEMINI_MODEL = process.env.GEMINI_LLM_MODEL ?? "gemini-2.5-flash";

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
    status?: string;
    code?: number;
  };
};

function extractGeminiText(payload: GeminiResponse | null) {
  return sanitizeLlmText(
    (payload?.candidates ?? [])
      .flatMap(candidate => candidate.content?.parts ?? [])
      .map(part => part.text ?? "")
      .join("\n")
  );
}

export async function generateGeminiText(input: LlmPromptInput): Promise<LlmProviderResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Throw a typed sentinel so the orchestrator skips without recording a health failure.
    // The orchestrator now guards this before calling, but keep as defence-in-depth.
    throw Object.assign(new Error("missing_api_key"), { skipHealthRecord: true });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const startedAt = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: input.system }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: input.user }],
          },
        ],
        generationConfig: {
          maxOutputTokens: input.maxTokens,
          temperature: 0.2,
        },
      }),
      signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null) as GeminiResponse | null;
    const text = extractGeminiText(payload);

    if (!response.ok) {
      throw new Error(payload?.error?.message ?? payload?.error?.status ?? `http_${response.status}`);
    }

    if (!text) {
      throw new Error("empty_response");
    }

    await recordLlmSuccess("Gemini", input, Date.now() - startedAt, "ok");
    return { text, provider: "gemini" };
  } catch (error) {
    await recordLlmFailure("Gemini", input, Date.now() - startedAt, formatLlmError(error));
    throw error;
  }
}
