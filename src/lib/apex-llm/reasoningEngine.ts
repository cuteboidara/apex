import {
  APEX_LLM_MAX_TOKENS,
  APEX_LLM_MODEL,
  getAnthropicClient,
} from "@/src/lib/apex-llm/client";
import { buildMarketCommentaryPrompt, buildSignalReasoningPrompt } from "@/src/lib/apex-llm/prompts";
import type {
  MarketCommentaryOutput,
  MarketCommentaryState,
  SignalReasoningContext,
  SignalReasoningOutput,
} from "@/src/lib/apex-llm/types";

const REASONING_CACHE_TTL_MS = 5 * 60_000;
const COMMENTARY_MAX_TOKENS = 400;
const ANTHROPIC_RETRY_COOLDOWN_MS = 10 * 60_000;
const ANTHROPIC_RATE_LIMIT_COOLDOWN_MS = 60_000;

const reasoningCache = new Map<string, { output: SignalReasoningOutput; cachedAt: number }>();
const commentaryCache = new Map<string, { output: MarketCommentaryOutput; cachedAt: number }>();
let anthropicWarningIssued = false;
let anthropicTemporarilyDisabledUntil = 0;
let anthropicTemporaryDisableReason: string | null = null;
let anthropicDisableWarningIssued = false;

function isLlmDisabled(): boolean {
  if ((process.env.APEX_DISABLE_LLM ?? "false").trim().toLowerCase() === "true") {
    return true;
  }

  if (process.env.APEX_ENABLE_LLM_IN_TESTS === "true") {
    return false;
  }

  return process.env.NODE_ENV === "test" ||
    process.execArgv.includes("--test") ||
    process.argv.includes("--test") ||
    process.argv.some(arg => arg.includes(".test."));
}

function buildReasoningCacheKey(ctx: SignalReasoningContext): string {
  return [
    ctx.symbol,
    ctx.direction,
    ctx.grade,
    ctx.session,
    ctx.marketPhase,
    ctx.structure,
    ctx.noTradeReason ?? "none",
    ctx.blockedReasons.join("|"),
    ctx.marketStateLabels.join("|"),
  ].join(":");
}

function buildCommentaryCacheKey(
  symbols: string[],
  marketStates: Record<string, MarketCommentaryState>,
): string {
  return symbols.map(symbol => {
    const state = marketStates[symbol];
    return `${symbol}:${state?.bias ?? "neutral"}:${state?.phase ?? "neutral"}:${state?.session ?? "unknown"}:${state?.labels.join("|") ?? ""}`;
  }).join("::");
}

function readCache<T>(cache: Map<string, { output: T; cachedAt: number }>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.cachedAt >= REASONING_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return cached.output;
}

function writeCache<T>(cache: Map<string, { output: T; cachedAt: number }>, key: string, output: T): void {
  cache.set(key, {
    output,
    cachedAt: Date.now(),
  });
}

function buildFallbackReasoning(ctx: SignalReasoningContext): SignalReasoningOutput {
  const setupNarrative = ctx.direction === "neutral"
    ? "The engine is tracking market structure, but directional agreement is not strong enough for an active trade."
    : `${ctx.bias} ${ctx.setupType.replaceAll("_", " ")} remains the current structural read.`;
  const noTradeExplanation = ctx.noTradeReason
    ? `No trade is available because the engine currently sees ${ctx.noTradeReason}.`
    : null;

  return {
    shortReasoning: noTradeExplanation ?? "Reasoning engine unavailable. Review the structural state and levels manually.",
    detailedReasoning: "AI reasoning is unavailable for this cycle. Core signal data, grading, and governance outputs are still valid.",
    whyThisSetup: setupNarrative,
    whyNow: `Current session context is ${ctx.session}, with market phase reading ${ctx.marketPhase}.`,
    whyThisLevel: ctx.entry != null
      ? "The entry is anchored to the active structural zone identified by the engine."
      : "No valid entry level is confirmed yet.",
    invalidation: "A decisive move through the relevant structural zone would invalidate the current read.",
    whyThisGrade: "Grade remains driven by confidence, confluence, and the current risk governor decision.",
    marketStructureSummary: `Current structure reads as ${ctx.structure} with a ${ctx.bias} bias.`,
    liquiditySummary: `Liquidity state is ${ctx.liquidityState}.`,
    keyLevelsSummary: "Previous day and session extremes remain the primary reference levels.",
    noTradeExplanation,
  };
}

function normalizeReasoningOutput(
  ctx: SignalReasoningContext,
  parsed: Partial<SignalReasoningOutput>,
): SignalReasoningOutput {
  const fallback = buildFallbackReasoning(ctx);
  return {
    shortReasoning: parsed.shortReasoning?.trim() || fallback.shortReasoning,
    detailedReasoning: parsed.detailedReasoning?.trim() || fallback.detailedReasoning,
    whyThisSetup: parsed.whyThisSetup?.trim() || fallback.whyThisSetup,
    whyNow: parsed.whyNow?.trim() || fallback.whyNow,
    whyThisLevel: parsed.whyThisLevel?.trim() || fallback.whyThisLevel,
    invalidation: parsed.invalidation?.trim() || fallback.invalidation,
    whyThisGrade: parsed.whyThisGrade?.trim() || fallback.whyThisGrade,
    marketStructureSummary: parsed.marketStructureSummary?.trim() || fallback.marketStructureSummary,
    liquiditySummary: parsed.liquiditySummary?.trim() || fallback.liquiditySummary,
    keyLevelsSummary: parsed.keyLevelsSummary?.trim() || fallback.keyLevelsSummary,
    noTradeExplanation: parsed.noTradeExplanation?.trim() || fallback.noTradeExplanation,
  };
}

function normalizeCommentaryOutput(parsed: Partial<MarketCommentaryOutput>): MarketCommentaryOutput | null {
  if (!parsed.overallContext || !parsed.sessionNote || !parsed.riskNote) {
    return null;
  }
  return {
    overallContext: parsed.overallContext.trim(),
    sessionNote: parsed.sessionNote.trim(),
    topOpportunity: parsed.topOpportunity?.trim() ?? "",
    riskNote: parsed.riskNote.trim(),
  };
}

function warnAnthropicUnavailable(): void {
  if (anthropicWarningIssued) {
    return;
  }
  anthropicWarningIssued = true;
  console.warn("[apex-llm] ANTHROPIC_API_KEY not set or LLM disabled — using fallback reasoning");
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || !error || !("status" in error)) {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown Anthropic client failure";
}

function isAnthropicTemporarilyDisabled(): boolean {
  if (anthropicTemporarilyDisabledUntil <= Date.now()) {
    anthropicTemporarilyDisabledUntil = 0;
    anthropicTemporaryDisableReason = null;
    anthropicDisableWarningIssued = false;
    return false;
  }

  return true;
}

function warnAnthropicTemporarilyDisabled(): void {
  if (anthropicDisableWarningIssued || !isAnthropicTemporarilyDisabled()) {
    return;
  }

  anthropicDisableWarningIssued = true;
  const secondsRemaining = Math.max(1, Math.ceil((anthropicTemporarilyDisabledUntil - Date.now()) / 1000));
  console.warn(
    `[apex-llm] Anthropic calls temporarily suppressed for ${secondsRemaining}s due to ${anthropicTemporaryDisableReason ?? "a previous client failure"}`,
  );
}

function registerAnthropicFailure(error: unknown): void {
  const status = getErrorStatus(error);
  if (status == null || status < 400 || status >= 500) {
    return;
  }

  anthropicTemporarilyDisabledUntil = Date.now() + (status === 429
    ? ANTHROPIC_RATE_LIMIT_COOLDOWN_MS
    : ANTHROPIC_RETRY_COOLDOWN_MS);
  anthropicTemporaryDisableReason = `[${status}] ${getErrorMessage(error)}`;
  anthropicDisableWarningIssued = false;
  warnAnthropicTemporarilyDisabled();
}

function extractAnthropicJsonText(response: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const textBlock = response.content.find(block => block.type === "text");
  if (!textBlock || textBlock.type !== "text" || typeof textBlock.text !== "string") {
    throw new Error("No text block in response");
  }

  return textBlock.text.replace(/```json|```/g, "").trim();
}

export async function generateSignalReasoning(
  ctx: SignalReasoningContext,
): Promise<SignalReasoningOutput> {
  if (isLlmDisabled() || !process.env.ANTHROPIC_API_KEY) {
    warnAnthropicUnavailable();
    return buildFallbackReasoning(ctx);
  }

  if (isAnthropicTemporarilyDisabled()) {
    warnAnthropicTemporarilyDisabled();
    return buildFallbackReasoning(ctx);
  }

  const cacheKey = buildReasoningCacheKey(ctx);
  const cached = readCache(reasoningCache, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const prompt = buildSignalReasoningPrompt(ctx);
    const response = await getAnthropicClient().messages.create({
      model: APEX_LLM_MODEL,
      max_tokens: APEX_LLM_MAX_TOKENS,
      system: "You are the focused APEX FX reasoning engine. Respond with valid JSON only.",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });
    const parsed = JSON.parse(extractAnthropicJsonText(response)) as Partial<SignalReasoningOutput>;
    const normalized = normalizeReasoningOutput(ctx, parsed);
    writeCache(reasoningCache, cacheKey, normalized);
    return normalized;
  } catch (error) {
    registerAnthropicFailure(error);
    console.error("[apex-llm] Signal reasoning failed:", error);
    return buildFallbackReasoning(ctx);
  }
}

export async function generateMarketCommentary(
  symbols: string[],
  marketStates: Record<string, MarketCommentaryState>,
): Promise<MarketCommentaryOutput | null> {
  if (isLlmDisabled() || !process.env.ANTHROPIC_API_KEY) {
    return null;
  }

  if (isAnthropicTemporarilyDisabled()) {
    warnAnthropicTemporarilyDisabled();
    return null;
  }

  const cacheKey = buildCommentaryCacheKey(symbols, marketStates);
  const cached = readCache(commentaryCache, cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const prompt = buildMarketCommentaryPrompt(symbols, marketStates);
    const response = await getAnthropicClient().messages.create({
      model: APEX_LLM_MODEL,
      max_tokens: Math.min(APEX_LLM_MAX_TOKENS, COMMENTARY_MAX_TOKENS),
      system: "You are the focused APEX FX market commentary engine. Respond with valid JSON only.",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });
    const parsed = JSON.parse(extractAnthropicJsonText(response)) as Partial<MarketCommentaryOutput>;
    const normalized = normalizeCommentaryOutput(parsed);
    if (!normalized) {
      return null;
    }
    writeCache(commentaryCache, cacheKey, normalized);
    return normalized;
  } catch (error) {
    registerAnthropicFailure(error);
    console.error("[apex-llm] Market commentary failed:", error);
    return null;
  }
}
