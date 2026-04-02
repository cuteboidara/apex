import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/requireAdmin";
import { prisma } from "@/src/infrastructure/db/prisma";

function describeRule(rule: string): string {
  return rule.replaceAll(".", " ").replaceAll("_", " ");
}

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
  const decisions = await prisma.riskEvaluatedCandidate.findMany({
    where: {
      created_at: {
        gte: since,
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });

  const candidateIds = decisions.map(item => item.candidate_id);
  const candidates = candidateIds.length === 0 ? [] : await prisma.tradeCandidate.findMany({
    where: {
      candidate_id: {
        in: candidateIds,
      },
    },
  });
  const candidatesById = new Map(candidates.map(candidate => [candidate.candidate_id, candidate]));

  const rules = new Map<string, {
    ruleCode: string;
    description: string;
    fires: number;
    signalsBlocked: number;
    pairs: Set<string>;
    sessions: Set<string>;
  }>();

  for (const decision of decisions) {
    const candidate = candidatesById.get(decision.candidate_id);
    const session = String(asRecord(candidate?.supporting_evidence).session ?? "unknown");
    const symbol = candidate?.symbol ?? "unknown";
    const codes = [...new Set([...decision.blocking_rules, ...decision.warnings])];

    for (const code of codes) {
      const entry = rules.get(code) ?? {
        ruleCode: code,
        description: describeRule(code),
        fires: 0,
        signalsBlocked: 0,
        pairs: new Set<string>(),
        sessions: new Set<string>(),
      };
      entry.fires += 1;
      if (decision.decision === "blocked") {
        entry.signalsBlocked += 1;
      }
      entry.pairs.add(symbol);
      entry.sessions.add(session);
      rules.set(code, entry);
    }
  }

  return NextResponse.json({
    days,
    rules: [...rules.values()]
      .sort((left, right) => right.fires - left.fires)
      .map(rule => ({
        ruleCode: rule.ruleCode,
        description: rule.description,
        fires: rule.fires,
        signalsBlocked: rule.signalsBlocked,
        pairsAffected: [...rule.pairs].sort(),
        sessions: [...rule.sessions].sort(),
      })),
  });
}
