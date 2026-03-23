import { formatLlmError, LLM_REQUEST_TIMEOUT_MS, recordLlmFailure, recordLlmSuccess, sanitizeLlmText } from "@/lib/llm/shared";
import type { LlmPromptInput, LlmProviderResponse } from "@/lib/llm/types";

const OPENAI_ENDPOINT = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_LLM_MODEL ?? "gpt-4o";

type OpenAiResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

function extractOpenAiText(payload: OpenAiResponse | null) {
  const direct = sanitizeLlmText(payload?.output_text);
  if (direct) return direct;

  return sanitizeLlmText(
    (payload?.output ?? [])
      .flatMap(item => item.content ?? [])
      .filter(item => item.type === "output_text" || item.type === "text")
      .map(item => item.text ?? "")
      .join("\n")
  );
}

export async function generateOpenAiText(input: LlmPromptInput): Promise<LlmProviderResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Throw a typed sentinel so the orchestrator skips without recording a health failure.
    // The orchestrator now guards this before calling, but keep as defence-in-depth.
    throw Object.assign(new Error("missing_api_key"), { skipHealthRecord: true });
  }

  const startedAt = Date.now();
  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        reasoning: { effort: "low" },
        max_output_tokens: input.maxTokens,
        input: [
          { role: "developer", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
      signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null) as OpenAiResponse | null;
    const text = extractOpenAiText(payload);

    if (!response.ok) {
      throw new Error(payload?.error?.message ?? payload?.error?.type ?? `http_${response.status}`);
    }

    if (!text) {
      throw new Error("empty_response");
    }

    await recordLlmSuccess("OpenAI", input, Date.now() - startedAt, "ok");
    return { text, provider: "openai" };
  } catch (error) {
    await recordLlmFailure("OpenAI", input, Date.now() - startedAt, formatLlmError(error));
    throw error;
  }
}
