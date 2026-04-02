import type { MarketCommentaryState, SignalReasoningContext } from "@/src/lib/apex-llm/types";

export function buildSignalReasoningPrompt(ctx: SignalReasoningContext): string {
  const rrEstimate = ctx.entry != null && ctx.sl != null && ctx.tp1 != null && Math.abs(ctx.entry - ctx.sl) > 0
    ? (Math.abs(ctx.tp1 - ctx.entry) / Math.abs(ctx.entry - ctx.sl)).toFixed(2)
    : "unknown";

  const priceContext = ctx.livePrice != null
    ? `Live price: ${ctx.livePrice}`
    : "Live price: unavailable";

  const tradeContext = ctx.entry != null
    ? `Entry: ${ctx.entry} | SL: ${ctx.sl ?? "none"} | TP1: ${ctx.tp1 ?? "none"} | TP2: ${ctx.tp2 ?? "none"} | RR: ${rrEstimate}`
    : "No active trade levels";

  return `You are the reasoning engine for APEX Intelligence, a private institutional FX signal system. Generate concise, precise trader-facing signal reasoning based on the following market state. Write like a senior SMC/ICT trader: direct, technical, and without filler.

SIGNAL CONTEXT:
- Pair: ${ctx.symbol}
- Direction: ${ctx.direction.toUpperCase()}
- Grade: ${ctx.grade}
- Setup: ${ctx.setupType}
- Session: ${ctx.session}
- Market phase: ${ctx.marketPhase}
- Structure: ${ctx.structure}
- Liquidity: ${ctx.liquidityState}
- Location: ${ctx.location}
- Zone: ${ctx.zoneType}
- Bias: ${ctx.bias}
- Confidence: ${(ctx.confidence * 100).toFixed(0)}%
- Market state: ${ctx.marketStateLabels.join(", ") || "none"}
- ${priceContext}
- ${tradeContext}
${ctx.noTradeReason ? `- No-trade reason: ${ctx.noTradeReason}` : ""}
${ctx.blockedReasons.length > 0 ? `- Blocked by: ${ctx.blockedReasons.join(", ")}` : ""}
${ctx.vetoes.length > 0 ? `- Risk vetoes: ${ctx.vetoes.join(", ")}` : ""}
- PDH: ${ctx.keyLevels.pdh ?? "n/a"} | PDL: ${ctx.keyLevels.pdl ?? "n/a"}
- Session H: ${ctx.keyLevels.sessionHigh ?? "n/a"} | Session L: ${ctx.keyLevels.sessionLow ?? "n/a"}
${ctx.smcContext ? `
SMC/ICT CONTEXT:
- Order Block: ${ctx.smcContext.orderBlock ?? "none identified"}
- Fair Value Gap: ${ctx.smcContext.fvg ?? "none"}
- Killzone: ${ctx.smcContext.killzone}
- PD Location: ${ctx.smcContext.pdLocation}
- In OTE Zone: ${ctx.smcContext.inOTE ? "YES" : "no"}
- COT Bias: ${ctx.smcContext.cotBias}
- Recent Sweep: ${ctx.smcContext.recentSweep ?? "none"}
- SMC Confluence: ${ctx.smcContext.smcVerdict.replace(/_/g, " ")}
` : ""}

Respond ONLY with a valid JSON object and no markdown. Use this exact schema:
{
  "shortReasoning": "1-2 sentence trader summary of why this signal exists or does not",
  "detailedReasoning": "3-5 sentence full context including structure, session, and what the engine is seeing",
  "whyThisSetup": "1-2 sentences: why this setup type is the right read here",
  "whyNow": "1-2 sentences: what makes this moment the right time",
  "whyThisLevel": "1-2 sentences: why this entry zone or level specifically",
  "invalidation": "1 sentence: what price action would cancel this setup",
  "whyThisGrade": "1-2 sentences: why this specific grade was assigned",
  "marketStructureSummary": "1 sentence describing current market structure for this pair",
  "liquiditySummary": "1 sentence on current liquidity conditions",
  "keyLevelsSummary": "1 sentence referencing the most relevant key level right now",
  "noTradeExplanation": ${ctx.noTradeReason ? "\"1 sentence plain-English explanation of why no trade is available right now\"" : "null"}
}`;
}

export function buildMarketCommentaryPrompt(
  symbols: string[],
  marketStates: Record<string, MarketCommentaryState>,
): string {
  const stateLines = symbols.map(symbol => {
    const state = marketStates[symbol];
    if (!state) {
      return `- ${symbol}: neutral bias | neutral phase | unavailable session | no labels`;
    }
    return `- ${symbol}: ${state.bias} bias | ${state.phase} phase | ${state.session} session | ${state.labels.join(", ") || "no labels"}`;
  }).join("\n");

  return `You are the market commentary engine for APEX Intelligence. Provide brief, direct FX market context for a private institutional operator.

CURRENT MARKET STATE:
${stateLines}

Respond ONLY with a valid JSON object:
{
  "overallContext": "2-3 sentences on overall FX market conditions right now",
  "sessionNote": "1 sentence on the current trading session and what to expect",
  "topOpportunity": "1 sentence on which pair, if any, has the best developing setup",
  "riskNote": "1 sentence on any risk factors to be aware of"
}`;
}
