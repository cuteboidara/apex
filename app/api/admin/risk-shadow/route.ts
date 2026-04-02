import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/requireAdmin";
import { prisma } from "@/src/infrastructure/db/prisma";

function parseRuleCodes(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const days = Math.max(1, Math.min(30, parseInt(searchParams.get("days") ?? "7", 10)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const logs: Array<{
    legacyRuleCodes: string;
    shadowRuleCodes: string;
    matched: boolean;
    recordedAt: Date;
  }> = await prisma.riskShadowLog.findMany({
    where: {
      recordedAt: {
        gte: since,
      },
    },
    orderBy: {
      recordedAt: "desc",
    },
  });

  const total = logs.length;
  const mismatches = logs.filter((log) => !log.matched).length;
  const mismatchRate = total > 0 ? Math.round((mismatches / total) * 100) : 0;

  const ruleBreakdown: Record<string, { legacy: number; shadow: number; mismatch: number }> = {};
  for (const log of logs) {
    const legacy = parseRuleCodes(log.legacyRuleCodes);
    const shadow = parseRuleCodes(log.shadowRuleCodes);
    const allRules = [...new Set([...legacy, ...shadow])];
    for (const rule of allRules) {
      ruleBreakdown[rule] ??= { legacy: 0, shadow: 0, mismatch: 0 };
      if (legacy.includes(rule)) ruleBreakdown[rule].legacy += 1;
      if (shadow.includes(rule)) ruleBreakdown[rule].shadow += 1;
      if (legacy.includes(rule) !== shadow.includes(rule)) ruleBreakdown[rule].mismatch += 1;
    }
  }

  const dailyBreakdown = Array.from({ length: days }, (_, index) => {
    const dayStart = new Date(since.getTime() + index * 24 * 60 * 60 * 1000);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const dayLogs = logs.filter((log) => log.recordedAt >= dayStart && log.recordedAt < dayEnd);
    const dayMismatches = dayLogs.filter((log) => !log.matched).length;
    return {
      date: dayStart.toISOString().split("T")[0],
      mismatchRate: dayLogs.length > 0 ? Math.round((dayMismatches / dayLogs.length) * 100) : 0,
      total: dayLogs.length,
    };
  });

  return NextResponse.json({
    mismatchRate,
    total,
    mismatches,
    safeToPromote: mismatchRate < 5,
    ruleBreakdown,
    dailyBreakdown,
    days,
  });
}
