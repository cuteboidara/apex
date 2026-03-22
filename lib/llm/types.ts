export type LlmProvider = "anthropic" | "openai" | "gemini";
export type LlmProviderOrNone = LlmProvider | "none";
export type LlmPurpose = "narrative" | "reasoning" | "insights" | "lifecycle";
export type ExplanationStatus = "generated" | "template" | "unavailable";
export type ExplanationRequestMode = "auto" | "explicit";
export type LlmAttemptStatus = "success" | "failed" | "skipped";

export type LlmPromptInput = {
  system: string;
  user: string;
  maxTokens: number;
  purpose: LlmPurpose;
  requestId?: string | null;
  fingerprint?: string | null;
};

export type LlmProviderResponse = {
  text: string;
  provider: LlmProvider;
};

export type LlmAttempt = {
  provider: LlmProvider;
  status: LlmAttemptStatus;
  reason: string | null;
};

export type LlmOrchestratorResponse = {
  text: string;
  provider: LlmProviderOrNone;
  fallbackUsed: boolean;
  status: "generated" | "unavailable";
  degradedReason: string | null;
  chain: LlmAttempt[];
};

export type ExplanationResponse = {
  text: string;
  provider: LlmProviderOrNone;
  fallbackUsed: boolean;
  status: ExplanationStatus;
  degradedReason: string | null;
  fingerprint: string;
  cached: boolean;
  generatedAt: string | null;
  chain: LlmAttempt[];
};

export type CachedExplanationRecord = {
  fingerprint: string;
  purpose: LlmPurpose;
  status: ExplanationStatus;
  provider: LlmProviderOrNone;
  fallbackUsed: boolean;
  fallbackChain: LlmAttempt[];
  content: string;
  errorMetadata: {
    degradedReason: string | null;
  } | null;
  generatedAt: string;
};
