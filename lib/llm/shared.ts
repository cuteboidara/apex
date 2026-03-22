import { recordProviderHealth } from "@/lib/providerHealth";
import type { LlmPromptInput } from "@/lib/llm/types";

export const LLM_REQUEST_TIMEOUT_MS = 15_000;

export function sanitizeLlmText(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function formatLlmError(error: unknown): string {
  return String(error).replace(/\s+/g, " ").trim().slice(0, 240);
}

export function buildHealthDetail(input: LlmPromptInput, detail: string) {
  const requestId = input.requestId ? `:${input.requestId}` : "";
  return `${input.purpose}${requestId}:${detail}`.slice(0, 240);
}

export async function recordLlmSuccess(provider: string, input: LlmPromptInput, latencyMs: number, detail = "ok") {
  await recordProviderHealth({
    provider,
    status: "OK",
    errorRate: 0,
    latencyMs,
    detail: buildHealthDetail(input, detail),
  });
}

export async function recordLlmFailure(provider: string, input: LlmPromptInput, latencyMs: number, detail: string) {
  await recordProviderHealth({
    provider,
    status: "ERROR",
    errorRate: 1,
    latencyMs,
    detail: buildHealthDetail(input, detail),
  });
}
