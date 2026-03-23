import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type OperationalMetricInput = {
  metric: string;
  category: string;
  severity?: string | null;
  unit?: string | null;
  value?: number | null;
  count?: number | null;
  provider?: string | null;
  symbol?: string | null;
  assetClass?: string | null;
  runId?: string | null;
  detail?: string | null;
  tags?: Record<string, unknown> | null;
};

function clampNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toJsonValue(tags: Record<string, unknown> | null | undefined) {
  return tags == null ? Prisma.JsonNull : (tags as Prisma.InputJsonValue);
}

export async function recordOperationalMetric(input: OperationalMetricInput): Promise<void> {
  try {
    await prisma.operationalMetric.create({
      data: {
        metric: input.metric,
        category: input.category,
        severity: input.severity ?? null,
        unit: input.unit ?? null,
        value: clampNumber(input.value),
        count: clampNumber(input.count),
        provider: input.provider ?? null,
        symbol: input.symbol ?? null,
        assetClass: input.assetClass ?? null,
        runId: input.runId ?? null,
        detail: input.detail ?? null,
        tags: toJsonValue(input.tags),
      },
    });
  } catch {
    // Metrics must never block core execution paths.
  }
}

export async function getOperationalMetricSummary(input?: {
  since?: Date;
  categories?: string[];
  metrics?: string[];
}) {
  const since = input?.since ?? new Date(Date.now() - 24 * 60 * 60_000);
  const rows = await prisma.operationalMetric.findMany({
    where: {
      recordedAt: { gte: since },
      ...(input?.categories?.length ? { category: { in: input.categories } } : {}),
      ...(input?.metrics?.length ? { metric: { in: input.metrics } } : {}),
    },
    orderBy: { recordedAt: "desc" },
    take: 500,
  });

  const byMetric = new Map<string, {
    metric: string;
    category: string;
    count: number;
    lastRecordedAt: string | null;
    latestValue: number | null;
    latestDetail: string | null;
    severities: Record<string, number>;
  }>();

  for (const row of rows) {
    const key = `${row.category}:${row.metric}`;
    if (!byMetric.has(key)) {
      byMetric.set(key, {
        metric: row.metric,
        category: row.category,
        count: 0,
        lastRecordedAt: null,
        latestValue: null,
        latestDetail: null,
        severities: {},
      });
    }

    const bucket = byMetric.get(key)!;
    bucket.count += row.count ?? 1;
    if (!bucket.lastRecordedAt) {
      bucket.lastRecordedAt = row.recordedAt.toISOString();
      bucket.latestValue = row.value ?? null;
      bucket.latestDetail = row.detail ?? null;
    }
    if (row.severity) {
      bucket.severities[row.severity] = (bucket.severities[row.severity] ?? 0) + 1;
    }
  }

  return Array.from(byMetric.values()).sort((left, right) => right.count - left.count);
}
