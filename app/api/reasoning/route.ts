import { NextRequest, NextResponse } from "next/server";
import { generateReasoningExplanation } from "@/lib/llm/explanationService";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRITERIA: Record<string, Array<[number, string]>> = {
  macro: [
    [20, "Rate environment, GDP trend, and sector narrative all support trade direction"],
    [15, "2 of 3 macro factors aligned"],
    [10, "Neutral macro, no major conflict"],
    [5,  "One macro factor working against the trade"],
    [0,  "Macro directly opposing the trade direction"],
  ],
  structure: [
    [20, "HTF and LTF structure fully aligned, clear BOS, clean trend"],
    [15, "HTF aligned, LTF minor chop"],
    [10, "Structure neutral or consolidating"],
    [5,  "LTF structure against HTF bias"],
    [0,  "Full structural breakdown against trade direction"],
  ],
  zones: [
    [20, "OB + FVG + S&D zone + trendline retest all aligning"],
    [15, "OB or S&D zone + one confluence factor"],
    [10, "Single clean zone, no confluence"],
    [5,  "Zone present but weak or partially mitigated"],
    [0,  "No zone present, price in open air"],
  ],
  technical: [
    [20, "LTF entry candle confirmed + volume spike + RSI aligned + no liquidity grab risk"],
    [15, "Entry candle + momentum aligned, volume average"],
    [10, "Entry candle present, momentum neutral"],
    [5,  "Weak entry signal, not fully confirmed"],
    [0,  "No confirmation, pure anticipation"],
  ],
  timing: [
    [20, "London or NY session open + no high-impact news within 4hrs + sentiment aligned"],
    [15, "Good session timing + sentiment neutral"],
    [10, "Off-session but setup strong, no news risk"],
    [5,  "High impact news nearby or sentiment opposing"],
    [0,  "News in next hour or Asian session low liquidity"],
  ],
};

function getActiveCriterion(value: number, items: Array<[number, string]>): string {
  for (const [score, desc] of items) {
    if (value >= score) return desc;
  }
  return items[items.length - 1][1];
}

export async function POST(req: NextRequest) {
  const {
    asset, direction, rank, total,
    macro, structure, zones, technical, timing,
    patterns, lastTrade,
  } = await req.json();

  const contextLines: string[] = [];
  if (patterns) {
    contextLines.push(`Personal pattern note: ${String(patterns).slice(0, 220)}`);
  }
  if (lastTrade) {
    contextLines.push(`Last trade on ${asset}: ${lastTrade.outcome} at rank ${lastTrade.rank}`);
  }

  const userMessage = `Asset: ${asset}
Direction: ${direction}
Rank: ${rank} | Total Score: ${total}/100

Dimension Scores:
- Macro Fundamentals: ${macro}/20 — ${getActiveCriterion(macro, CRITERIA.macro)}
- Market Structure: ${structure}/20 — ${getActiveCriterion(structure, CRITERIA.structure)}
- Institutional Zones: ${zones}/20 — ${getActiveCriterion(zones, CRITERIA.zones)}
- Technical Confirmation: ${technical}/20 — ${getActiveCriterion(technical, CRITERIA.technical)}
- Timing & Sentiment: ${timing}/20 — ${getActiveCriterion(timing, CRITERIA.timing)}${contextLines.length ? "\n\n" + contextLines.join("\n") : ""}`;

  const result = await generateReasoningExplanation({
    template: {
      asset,
      direction,
      rank,
      total,
      macro,
      structure,
      zones,
      technical,
      timing,
    },
    prompt: {
      system:
        "You are APEX — a personal trading intelligence engine built for one trader. You write exactly one paragraph, maximum 150 words, plain text only, zero markdown, zero headers, zero bullet points. You write like a sharp senior trader thinking out loud before entering a position. Direct, ruthless, clear. You cover four things in order: (1) what the rank means for conviction and position size, (2) what dimensions are strongest and why they matter for this trade, (3) the weakest link and exact scenario that invalidates this setup, (4) one execution instruction — timing, size, or key level to watch.",
      user: userMessage,
      maxTokens: 320,
      requestId: typeof asset === "string" ? asset : null,
    },
    mode: "explicit",
  });
  return NextResponse.json({
    reasoning: result.text,
    provider: result.provider,
    fallbackUsed: result.fallbackUsed,
    status: result.status,
    degradedReason: result.degradedReason,
    cached: result.cached,
  });
}
