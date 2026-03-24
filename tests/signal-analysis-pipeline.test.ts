import assert from "node:assert/strict";
import test from "node:test";

import { runSignalAnalysisPipeline, type SignalAnalysisInput } from "@/lib/ai/signalAnalysisPipeline";

const INPUT: SignalAnalysisInput = {
  asset: "BTCUSDT",
  direction: "LONG",
  rank: "A",
  total: 78,
  macro: 14,
  structure: 16,
  zones: 15,
  technical: 17,
  timing: 16,
  price: 68500,
  rsi: 58.4,
  trend: "uptrend",
  closes: [67000, 67200, 67650, 68100, 68500],
  setupFamily: "liquidity-sweep",
  regimeTag: "trending",
  newsHeadlines: ["Bitcoin extends breakout as ETF inflows rise"],
  fedFunds: 4.5,
  cpi: "3.1",
  treasury10y: "4.2",
  entryPrice: 68420,
  tp1: 69000,
  tp2: 69600,
  tp3: 70250,
  stopLoss: 67680,
  sessionUTC: 12,
};

test("signal analysis pipeline runs with OpenAI + Gemini only and does not require Anthropic", async () => {
  const originalFetch = globalThis.fetch;
  const originalOpenAi = process.env.OPENAI_API_KEY;
  const originalGemini = process.env.GEMINI_API_KEY;
  const originalAnthropic = process.env.ANTHROPIC_API_KEY;
  const originalDisableLlm = process.env.APEX_DISABLE_LLM;
  const originalCoreMode = process.env.APEX_CORE_SIGNAL_MODE;

  let openAiCalls = 0;
  let geminiCalls = 0;

  process.env.OPENAI_API_KEY = "test-openai";
  process.env.GEMINI_API_KEY = "test-gemini";
  process.env.APEX_DISABLE_LLM = "false";
  process.env.APEX_CORE_SIGNAL_MODE = "hybrid";
  delete process.env.ANTHROPIC_API_KEY;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("api.openai.com")) {
      openAiCalls += 1;
      const content = openAiCalls === 1
        ? JSON.stringify({
            explanation: "BTCUSDT is holding above the reclaimed breakout zone with trend support intact.",
            marketContext: "Macro remains supportive and crypto breadth is firm.",
            entryRefinement: "Wait for shallow pullbacks into the reclaimed range high.",
            impliedConfidence: 74,
          })
        : JSON.stringify({
            riskAssessment: "A fast reversal through the breakout zone would invalidate the momentum thesis.",
            invalidationLevel: "67680",
            riskAdjustedConfidence: 68,
          });

      return new Response(JSON.stringify({
        choices: [{ message: { content } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                confidenceScore: 71,
                confidenceReasoning: "Trend alignment still outweighs the defined invalidation risk.",
                verdict: "STRONG",
              }),
            }],
          },
        }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("unexpected_url", { status: 500 });
  };

  try {
    const output = await runSignalAnalysisPipeline(INPUT);

    assert.ok(output);
    assert.equal(output.provider, "gpt4+gemini");
    assert.equal(output.gptConfidence, 74);
    assert.equal(output.claudeConfidence, 68);
    assert.equal(output.geminiConfidence, 71);
    assert.equal(output.verdict, "STRONG");
    assert.match(output.unifiedAnalysis, /Confidence: 71\/100/i);
    assert.equal(openAiCalls, 2);
    assert.equal(geminiCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;

    if (originalOpenAi == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAi;

    if (originalGemini == null) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGemini;

    if (originalAnthropic == null) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropic;

    if (originalDisableLlm == null) delete process.env.APEX_DISABLE_LLM;
    else process.env.APEX_DISABLE_LLM = originalDisableLlm;

    if (originalCoreMode == null) delete process.env.APEX_CORE_SIGNAL_MODE;
    else process.env.APEX_CORE_SIGNAL_MODE = originalCoreMode;
  }
});

test("signal analysis pipeline short-circuits cleanly when llm is disabled", async () => {
  const originalDisableLlm = process.env.APEX_DISABLE_LLM;
  const originalCoreMode = process.env.APEX_CORE_SIGNAL_MODE;

  process.env.APEX_DISABLE_LLM = "true";
  process.env.APEX_CORE_SIGNAL_MODE = "deterministic";

  try {
    const output = await runSignalAnalysisPipeline(INPUT);
    assert.equal(output, null);
  } finally {
    if (originalDisableLlm == null) delete process.env.APEX_DISABLE_LLM;
    else process.env.APEX_DISABLE_LLM = originalDisableLlm;

    if (originalCoreMode == null) delete process.env.APEX_CORE_SIGNAL_MODE;
    else process.env.APEX_CORE_SIGNAL_MODE = originalCoreMode;
  }
});
