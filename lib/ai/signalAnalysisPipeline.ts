import { callGPT4   } from "@/lib/ai/providers/openai";
import { callClaude  } from "@/lib/ai/providers/claude";
import { callGemini  } from "@/lib/ai/providers/gemini";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SignalAnalysisInput {
  asset:          string;
  direction:      "LONG" | "SHORT";
  rank:           "B" | "A" | "S";
  total:          number;
  macro:          number;
  structure:      number;
  zones:          number;
  technical:      number;
  timing:         number;
  price:          number;
  rsi:            number | null;
  trend:          string | null;
  closes:         number[];
  setupFamily:    string | null;
  regimeTag:      string | null;
  newsHeadlines:  string[];
  fedFunds:       number | null;
  cpi:            string | null;
  treasury10y:    string | null;
  entryPrice:     number | null;
  tp1:            number | null;
  tp2:            number | null;
  tp3:            number | null;
  stopLoss:       number | null;
  sessionUTC:     number;  // UTC hour 0-23
}

export interface SignalAnalysisOutput {
  // Stage 1 — GPT-4
  explanation:         string;
  marketContext:       string;
  entryRefinement:     string;
  gptConfidence:       number;

  // Stage 2 — Claude
  riskAssessment:      string;
  invalidationLevel:   string;
  claudeConfidence:    number;

  // Stage 3 — Gemini
  geminiConfidence:    number;
  confidenceReasoning: string;
  verdict:             string;  // STRONG | MODERATE | WEAK | AVOID

  // Merged
  unifiedAnalysis:     string;

  provider:    "gpt4+claude+gemini";
  generatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSessionName(utcHour: number): string {
  if (utcHour < 7)  return "Asian session";
  if (utcHour < 9)  return "London open";
  if (utcHour < 12) return "London session";
  if (utcHour < 16) return "NY/London overlap";
  if (utcHour < 20) return "New York session";
  return "After-hours";
}

function clamp100(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Extracts the first JSON object from an LLM response (handles markdown fences). */
function safeParseJson<T extends object>(text: string): T | null {
  // Try raw
  try { return JSON.parse(text) as T; } catch { /* fall through */ }

  // Strip markdown code fences
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1].trim()) as T; } catch { /* fall through */ }
  }

  // Greedy {...}
  const greedy = text.match(/\{[\s\S]*\}/);
  if (greedy) {
    try { return JSON.parse(greedy[0]) as T; } catch { /* fall through */ }
  }

  return null;
}

// ── Stage 1 — GPT-4 Lead Analysis ─────────────────────────────────────────────

const GPT4_SYSTEM = `You are an institutional forex and crypto trading analyst specializing in Smart Money Concepts (SMC) and ICT methodology. You analyze signals with precision and write like a senior trader — concise, confident, no fluff.`;

type Gpt4Output = {
  explanation:       string;
  marketContext:     string;
  entryRefinement:   string;
  impliedConfidence: number;
};

async function runStage1(input: SignalAnalysisInput): Promise<Gpt4Output | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.log(`[APEX:ai] OpenAI key missing — skipping stage 1 (GPT-4) for ${input.asset}`);
    return null;
  }
  const headlines = input.newsHeadlines.slice(0, 3).join(" | ") || "No recent headlines";
  const session   = getSessionName(input.sessionUTC);
  const rsi       = input.rsi != null ? input.rsi.toFixed(1) : "N/A";
  const fedStr    = input.fedFunds != null ? `${input.fedFunds}%` : "N/A";
  const t10yStr   = input.treasury10y ?? "N/A";

  const userPrompt = `Analyze this trading signal:

Asset: ${input.asset} | Direction: ${input.direction} | Rank: ${input.rank} (${input.total}/100)
Current Price: ${input.price} | RSI: ${rsi} | Trend: ${input.trend ?? "N/A"}
Session: ${session}

Score Breakdown:
- Macro: ${input.macro}/20 — Fed Funds: ${fedStr}, CPI: ${input.cpi ?? "N/A"}, 10Y: ${t10yStr}%
- Structure: ${input.structure}/20 — ${input.setupFamily ?? "SMC structure"}
- Zones: ${input.zones}/20
- Technical: ${input.technical}/20
- Timing: ${input.timing}/20

Trade Levels:
- Entry: ${input.entryPrice ?? "at market"} | SL: ${input.stopLoss ?? "N/A"}
- TP1: ${input.tp1 ?? "N/A"} | TP2: ${input.tp2 ?? "N/A"} | TP3: ${input.tp3 ?? "N/A"}

Recent headlines: ${headlines}
Regime: ${input.regimeTag ?? "N/A"}

Provide:
1. EXPLANATION (2-3 sentences): Why this signal fires — reference the specific SMC confluences
2. MARKET_CONTEXT (1-2 sentences): Current macro/market environment relevance
3. ENTRY_REFINEMENT (1-2 sentences): Commentary on the entry zone and key levels to watch

Respond ONLY with valid JSON — no markdown, no extra text:
{ "explanation": "...", "marketContext": "...", "entryRefinement": "...", "impliedConfidence": <number 0-100> }`;

  const raw = await callGPT4(GPT4_SYSTEM, userPrompt);
  if (!raw) {
    console.error(`[APEX:ai] Stage 1 (GPT-4) failed for ${input.asset}: no response`);
    return null;
  }

  const parsed = safeParseJson<Gpt4Output>(raw);
  if (!parsed) {
    console.error(`[APEX:ai] Stage 1 (GPT-4) failed for ${input.asset}: JSON parse error`);
    return null;
  }

  return {
    explanation:       String(parsed.explanation       ?? "").trim(),
    marketContext:     String(parsed.marketContext     ?? "").trim(),
    entryRefinement:   String(parsed.entryRefinement   ?? "").trim(),
    impliedConfidence: clamp100(parsed.impliedConfidence),
  };
}

// ── Stage 2 — Claude Risk Assessment ──────────────────────────────────────────

const CLAUDE_SYSTEM = `You are a risk management specialist for an algorithmic trading system. You identify what could go wrong with trades and define clear invalidation criteria. Be direct and specific — no generic warnings.`;

type ClaudeOutput = {
  riskAssessment:          string;
  invalidationLevel:       string;
  riskAdjustedConfidence:  number;
};

async function runStage2(
  input: SignalAnalysisInput,
  stage1: Gpt4Output | null,
): Promise<ClaudeOutput | null> {
  const gptContext = stage1
    ? `GPT-4 has analyzed this ${input.asset} ${input.direction} signal (rank ${input.rank}, score ${input.total}/100):

GPT-4 Analysis:
${stage1.explanation}
${stage1.marketContext}
${stage1.entryRefinement}`
    : `Signal: ${input.asset} ${input.direction} (rank ${input.rank}, score ${input.total}/100). No prior analysis available.`;

  const userPrompt = `${gptContext}

Signal data:
- Price: ${input.price}, SL: ${input.stopLoss ?? "N/A"}, Entry: ${input.entryPrice ?? "at market"}
- RSI: ${input.rsi != null ? input.rsi.toFixed(1) : "N/A"}, Structure: ${input.structure}/20, Zones: ${input.zones}/20
- Macro: ${input.macro}/20

Your job: Risk assessment only.

Provide:
1. RISK_ASSESSMENT (2-3 sentences): Top 2-3 specific risks for this exact trade right now
2. INVALIDATION_LEVEL: The specific price level that proves this trade wrong (be precise)
3. RISK_ADJUSTED_CONFIDENCE: 0-100 score after considering the risks

Respond ONLY with valid JSON — no markdown, no extra text:
{ "riskAssessment": "...", "invalidationLevel": "...", "riskAdjustedConfidence": <number 0-100> }`;

  const raw = await callClaude(CLAUDE_SYSTEM, userPrompt);
  if (!raw) {
    console.error(`[APEX:ai] Stage 2 (Claude) failed for ${input.asset}: no response`);
    return null;
  }

  const parsed = safeParseJson<ClaudeOutput>(raw);
  if (!parsed) {
    console.error(`[APEX:ai] Stage 2 (Claude) failed for ${input.asset}: JSON parse error`);
    return null;
  }

  return {
    riskAssessment:         String(parsed.riskAssessment         ?? "").trim(),
    invalidationLevel:      String(parsed.invalidationLevel      ?? "").trim(),
    riskAdjustedConfidence: clamp100(parsed.riskAdjustedConfidence),
  };
}

// ── Stage 3 — Gemini Confidence Score ─────────────────────────────────────────

type GeminiOutput = {
  confidenceScore:     number;
  confidenceReasoning: string;
  verdict:             string;
};

async function runStage3(
  input:  SignalAnalysisInput,
  stage1: Gpt4Output | null,
  stage2: ClaudeOutput | null,
): Promise<GeminiOutput | null> {
  if (!process.env.GEMINI_API_KEY) {
    console.log(`[APEX:ai] Gemini key missing — skipping stage 3 (Gemini) for ${input.asset}`);
    return null;
  }
  const gpt4Section = stage1
    ? `GPT-4 LEAD ANALYSIS:
${stage1.explanation}
${stage1.marketContext}
${stage1.entryRefinement}
Implied confidence: ${stage1.impliedConfidence}`
    : "GPT-4 LEAD ANALYSIS: Not available.";

  const claudeSection = stage2
    ? `CLAUDE RISK ASSESSMENT:
${stage2.riskAssessment}
Invalidation: ${stage2.invalidationLevel}
Risk-adjusted confidence: ${stage2.riskAdjustedConfidence}`
    : "CLAUDE RISK ASSESSMENT: Not available.";

  const prompt = `You are a quantitative analyst providing a final confidence score for a trading signal after reviewing two analyst reports.

Review this complete signal analysis and provide a final confidence score:

SIGNAL: ${input.asset} ${input.direction} | Score: ${input.total}/100 | Rank: ${input.rank}

${gpt4Section}

${claudeSection}

Your task: Final independent confidence score.

Consider:
- Alignment between GPT-4 optimism and Claude's risk flags
- Signal score quality (${input.total}/100 with rank ${input.rank})
- Whether the risk/reward justifies the trade at current levels

Respond ONLY with valid JSON — no markdown, no extra text:
{ "confidenceScore": <number 0-100>, "confidenceReasoning": "<1-2 sentences>", "verdict": "STRONG" | "MODERATE" | "WEAK" | "AVOID" }`;

  const raw = await callGemini(prompt);
  if (!raw) {
    console.error(`[APEX:ai] Stage 3 (Gemini) failed for ${input.asset}: no response`);
    return null;
  }

  const parsed = safeParseJson<GeminiOutput>(raw);
  if (!parsed) {
    console.error(`[APEX:ai] Stage 3 (Gemini) failed for ${input.asset}: JSON parse error`);
    return null;
  }

  const VALID_VERDICTS = new Set(["STRONG", "MODERATE", "WEAK", "AVOID"]);
  const verdict = VALID_VERDICTS.has(String(parsed.verdict ?? "").toUpperCase())
    ? String(parsed.verdict).toUpperCase()
    : "MODERATE";

  return {
    confidenceScore:     clamp100(parsed.confidenceScore),
    confidenceReasoning: String(parsed.confidenceReasoning ?? "").trim(),
    verdict,
  };
}

// ── Stage 4 — Merge ───────────────────────────────────────────────────────────

function buildUnifiedAnalysis(
  input:  SignalAnalysisInput,
  stage1: Gpt4Output | null,
  stage2: ClaudeOutput | null,
  stage3: GeminiOutput | null,
): string {
  const explanation        = stage1?.explanation       || `${input.asset} ${input.direction} signal (rank ${input.rank}, score ${input.total}/100).`;
  const context            = stage1?.marketContext     || "";
  const risk               = stage2?.riskAssessment    || "Risk assessment unavailable.";
  const invalidation       = stage2?.invalidationLevel || (input.stopLoss ? String(input.stopLoss) : "below stop loss");
  const confidence         = stage3?.confidenceScore   ?? stage2?.riskAdjustedConfidence ?? stage1?.impliedConfidence ?? 50;
  const confidenceReasoning = stage3?.confidenceReasoning || "";

  const parts = [
    explanation,
    context,
    `However, ${risk}`,
    `Key invalidation at ${invalidation}.`,
    `Confidence: ${confidence}/100${confidenceReasoning ? ` — ${confidenceReasoning}` : ""}.`,
  ].filter(Boolean).map(s => s.trim()).filter(s => s.length > 0);

  return parts.join(" ");
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Runs the 3-stage AI pipeline: GPT-4 → Claude → Gemini.
 * Each stage receives the previous output as context.
 * Any stage can fail independently — the pipeline continues and degrades gracefully.
 * Returns null only when all three stages fail.
 */
export async function runSignalAnalysisPipeline(
  input: SignalAnalysisInput,
): Promise<SignalAnalysisOutput | null> {
  // Stage 1
  const stage1 = await runStage1(input).catch(err => {
    console.error(`[APEX:ai] Stage 1 (GPT-4) threw for ${input.asset}:`, String(err).slice(0, 120));
    return null;
  });

  // Stage 2 — runs even if Stage 1 failed
  const stage2 = await runStage2(input, stage1).catch(err => {
    console.error(`[APEX:ai] Stage 2 (Claude) threw for ${input.asset}:`, String(err).slice(0, 120));
    return null;
  });

  // Stage 3 — runs even if Stage 1 or 2 failed
  const stage3 = await runStage3(input, stage1, stage2).catch(err => {
    console.error(`[APEX:ai] Stage 3 (Gemini) threw for ${input.asset}:`, String(err).slice(0, 120));
    return null;
  });

  // If all three stages failed, return null so the caller knows to skip the DB write
  if (!stage1 && !stage2 && !stage3) {
    console.error(`[APEX:ai] All 3 stages failed for ${input.asset} — pipeline aborted`);
    return null;
  }

  return {
    // Stage 1
    explanation:         stage1?.explanation       ?? "",
    marketContext:       stage1?.marketContext      ?? "",
    entryRefinement:     stage1?.entryRefinement    ?? "",
    gptConfidence:       stage1?.impliedConfidence  ?? 50,

    // Stage 2
    riskAssessment:      stage2?.riskAssessment         ?? "Risk assessment unavailable.",
    invalidationLevel:   stage2?.invalidationLevel       ?? (input.stopLoss ? String(input.stopLoss) : ""),
    claudeConfidence:    stage2?.riskAdjustedConfidence  ?? 50,

    // Stage 3
    geminiConfidence:    stage3?.confidenceScore     ?? 50,
    confidenceReasoning: stage3?.confidenceReasoning ?? "",
    verdict:             stage3?.verdict             ?? "MODERATE",

    // Merged
    unifiedAnalysis: buildUnifiedAnalysis(input, stage1, stage2, stage3),

    provider:    "gpt4+claude+gemini",
    generatedAt: new Date().toISOString(),
  };
}
