import { NextRequest, NextResponse } from "next/server";
import { generateInsightsExplanation } from "@/lib/llm/explanationService";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Trade {
  asset: string;
  direction: string;
  rank: string;
  total: number;
  macro: number;
  structure: number;
  zones: number;
  technical: number;
  timing: number;
  outcome: string;
  pnl: number | null;
}

export async function POST(req: NextRequest) {
  const { trades } = (await req.json()) as { trades: Trade[] };

  if (trades.length < 5) {
    return NextResponse.json({ insights: "", provider: "none", fallbackUsed: false, status: "template", degradedReason: "insufficient_trade_history", cached: false });
  }

  const list = trades
    .map(
      (t, i) =>
        `${i + 1}. ${t.asset} ${t.direction} | Rank ${t.rank} | Score ${t.total} (M:${t.macro} S:${t.structure} Z:${t.zones} T:${t.technical} Ti:${t.timing}) | ${t.outcome}${t.pnl != null ? ` | PnL: ${t.pnl}%` : ""}`
    )
    .join("\n");

  const result = await generateInsightsExplanation({
    trades: trades.map(trade => ({
      asset: trade.asset,
      direction: trade.direction,
      rank: trade.rank,
      total: trade.total,
      outcome: trade.outcome,
      pnl: trade.pnl,
    })),
    prompt: {
      system:
        "You are APEX pattern engine. Analyze this trader's history and return exactly 3 insights in plain text, numbered 1-2-3, no markdown. Each insight should identify a specific pattern in their scoring behavior that correlates with wins or losses. Be direct and specific with numbers. Max 120 words total.",
      user: `Here are my trades:\n\n${list}\n\nGive me 3 specific pattern insights.`,
      maxTokens: 320,
      requestId: `trade-count-${trades.length}`,
    },
    mode: "explicit",
  });
  return NextResponse.json({
    insights: result.text,
    provider: result.provider,
    fallbackUsed: result.fallbackUsed,
    status: result.status,
    degradedReason: result.degradedReason,
    cached: result.cached,
  });
}
