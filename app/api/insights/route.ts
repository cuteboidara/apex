import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@/lib/anthropic";

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
    return NextResponse.json({ insights: "" });
  }

  const list = trades
    .map(
      (t, i) =>
        `${i + 1}. ${t.asset} ${t.direction} | Rank ${t.rank} | Score ${t.total} (M:${t.macro} S:${t.structure} Z:${t.zones} T:${t.technical} Ti:${t.timing}) | ${t.outcome}${t.pnl != null ? ` | PnL: ${t.pnl}%` : ""}`
    )
    .join("\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 320,
    system:
      "You are APEX pattern engine. Analyze this trader's history and return exactly 3 insights in plain text, numbered 1-2-3, no markdown. Each insight should identify a specific pattern in their scoring behavior that correlates with wins or losses. Be direct and specific with numbers. Max 120 words total.",
    messages: [
      {
        role: "user",
        content: `Here are my trades:\n\n${list}\n\nGive me 3 specific pattern insights.`,
      },
    ],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";

  return NextResponse.json({ insights: text });
}
