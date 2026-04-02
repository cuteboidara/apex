import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/requireAdmin";
import { prisma } from "@/src/infrastructure/db/prisma";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(30, parseInt(searchParams.get("days") ?? "7", 10)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [candidates, signals, viewModels] = await Promise.all([
    prisma.tradeCandidate.findMany({
      where: {
        created_at: {
          gte: since,
        },
      },
      orderBy: {
        created_at: "desc",
      },
    }),
    prisma.executableSignal.findMany({
      where: {
        created_at: {
          gte: since,
        },
      },
      orderBy: {
        created_at: "desc",
      },
    }),
    prisma.signalViewModel.findMany({
      where: {
        generated_at: {
          gte: since,
        },
      },
      orderBy: {
        generated_at: "desc",
      },
    }),
  ]);

  const signaledCandidates = new Set(signals.map(signal => signal.candidate_id));
  const byPair = new Map<string, { candidates: number; executable: number }>();
  const byStrategy = new Map<string, { candidates: number; executable: number }>();
  const bySession = new Map<string, { candidates: number; executable: number }>();

  for (const candidate of candidates) {
    const evidence = asRecord(candidate.supporting_evidence);
    const strategy = String(evidence.entry_style ?? "unknown");
    const session = String(evidence.session ?? "unknown");
    const pair = byPair.get(candidate.symbol) ?? { candidates: 0, executable: 0 };
    pair.candidates += 1;
    if (signaledCandidates.has(candidate.candidate_id)) pair.executable += 1;
    byPair.set(candidate.symbol, pair);

    const strategyEntry = byStrategy.get(strategy) ?? { candidates: 0, executable: 0 };
    strategyEntry.candidates += 1;
    if (signaledCandidates.has(candidate.candidate_id)) strategyEntry.executable += 1;
    byStrategy.set(strategy, strategyEntry);

    const sessionEntry = bySession.get(session) ?? { candidates: 0, executable: 0 };
    sessionEntry.candidates += 1;
    if (signaledCandidates.has(candidate.candidate_id)) sessionEntry.executable += 1;
    bySession.set(session, sessionEntry);
  }

  const gradeDistribution = new Map<string, number>();
  for (const row of viewModels) {
    const model = asRecord(asRecord(row.ui_sections).model);
    const grade = String(model.grade ?? "unknown");
    gradeDistribution.set(grade, (gradeDistribution.get(grade) ?? 0) + 1);
  }

  return NextResponse.json({
    days,
    totals: {
      candidates: candidates.length,
      executable: signals.length,
      candidateToExecutableRate: candidates.length > 0 ? Math.round((signals.length / candidates.length) * 100) : 0,
    },
    byPair: [...byPair.entries()].map(([symbol, counts]) => ({
      symbol,
      ...counts,
      conversionRate: counts.candidates > 0 ? Math.round((counts.executable / counts.candidates) * 100) : 0,
    })).sort((left, right) => right.conversionRate - left.conversionRate),
    byStrategy: [...byStrategy.entries()].map(([strategy, counts]) => ({
      strategy,
      ...counts,
      conversionRate: counts.candidates > 0 ? Math.round((counts.executable / counts.candidates) * 100) : 0,
    })),
    bySession: [...bySession.entries()].map(([session, counts]) => ({
      session,
      ...counts,
      conversionRate: counts.candidates > 0 ? Math.round((counts.executable / counts.candidates) * 100) : 0,
    })),
    gradeDistribution: [...gradeDistribution.entries()].map(([grade, count]) => ({
      grade,
      count,
    })),
  });
}
