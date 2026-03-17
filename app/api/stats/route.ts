import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const DIMS = ["macro", "structure", "zones", "technical", "timing"] as const;

export async function GET() {
  const logs = await prisma.tradeLog.findMany({
    include: { setup: true },
    where: { outcome: { not: null } },
  });

  const total = logs.length;
  const wins  = logs.filter(l => l.outcome === "WIN").length;
  const winRate = total > 0 ? Math.round((wins / total) * 100) : 0;
  const avgPnl  = total > 0
    ? Math.round(logs.reduce((s, l) => s + (l.pnl ?? 0), 0) / total * 10) / 10
    : 0;

  // ── By rank ────────────────────────────────────────────────────────────────
  const byRankRaw: Record<string, { trades: number; wins: number; pnlSum: number }> = {};
  for (const log of logs) {
    const r = log.setup.rank;
    if (!byRankRaw[r]) byRankRaw[r] = { trades: 0, wins: 0, pnlSum: 0 };
    byRankRaw[r].trades++;
    if (log.outcome === "WIN") byRankRaw[r].wins++;
    byRankRaw[r].pnlSum += log.pnl ?? 0;
  }
  const byRank: Record<string, { trades: number; wins: number; winRate: number; avgPnl: number }> = {};
  for (const [r, d] of Object.entries(byRankRaw)) {
    byRank[r] = {
      trades:  d.trades,
      wins:    d.wins,
      winRate: d.trades > 0 ? Math.round((d.wins  / d.trades) * 100)  : 0,
      avgPnl:  d.trades > 0 ? Math.round((d.pnlSum / d.trades) * 10) / 10 : 0,
    };
  }

  // ── Dimension correlation ──────────────────────────────────────────────────
  const winLogs  = logs.filter(l => l.outcome === "WIN");
  const lossLogs = logs.filter(l => l.outcome === "LOSS");

  const dimCorrelation: Record<string, { avgWin: number; avgLoss: number; diff: number }> = {};
  for (const dim of DIMS) {
    const avg = (arr: typeof logs) =>
      arr.length > 0
        ? Math.round(arr.reduce((s, l) => s + ((l.setup[dim] as number) ?? 0), 0) / arr.length * 10) / 10
        : 0;
    const avgWin  = avg(winLogs);
    const avgLoss = avg(lossLogs);
    dimCorrelation[dim] = { avgWin, avgLoss, diff: Math.round((avgWin - avgLoss) * 10) / 10 };
  }

  return NextResponse.json({ total, winRate, avgPnl, byRank, dimCorrelation });
}
