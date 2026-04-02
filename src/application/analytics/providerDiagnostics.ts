import { prisma } from "@/src/infrastructure/db/prisma";
import type { SignalAssetClass } from "@/src/domain/models/signalHealth";
import type { ProviderReliabilitySummary } from "@/src/application/analytics/alphaTypes";
import { computeOutcomeAwareProviderScore } from "@/src/assets/shared/providerHealth";

type ProviderHealthRow = Awaited<ReturnType<typeof prisma.providerHealth.findMany>>[number];

const PROVIDER_DIAGNOSTIC_CACHE_TTL_MS = 2 * 60_000;

const globalForProviderDiagnostics = globalThis as typeof globalThis & {
  __apexProviderDiagnosticsCache?: Map<string, { value: ProviderReliabilitySummary[]; generatedAt: number }>;
};

const diagnosticsCache = globalForProviderDiagnostics.__apexProviderDiagnosticsCache ??= new Map<
  string,
  { value: ProviderReliabilitySummary[]; generatedAt: number }
>();

function normalizeProviderStatus(status: string | null | undefined): "success" | "degraded" | "failure" {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized === "ok" || normalized === "healthy" || normalized === "ready") {
    return "success";
  }
  if (normalized === "degraded" || normalized === "empty_body" || normalized === "no_data") {
    return "degraded";
  }
  return "failure";
}

function inferAssetClassFromSymbol(symbol: string | null | undefined): SignalAssetClass | null {
  const normalized = String(symbol ?? "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized.endsWith("USDT")) {
    return ["DOGEUSDT", "SHIBUSDT", "PEPEUSDT", "WIFUSDT"].includes(normalized) ? "memecoin" : "crypto";
  }
  if (/^[A-Z]{6}$/.test(normalized)) {
    return "fx";
  }
  if (["XAUUSD", "XAGUSD", "WTICOUSD", "BCOUSD", "NATGASUSD"].includes(normalized)) {
    return "commodity";
  }
  if (["SPX", "NDX", "DJI", "UKX", "DAX", "NKY"].includes(normalized)) {
    return "index";
  }
  if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) {
    return "stock";
  }
  return null;
}

function inferAssetClassFromRow(row: Pick<ProviderHealthRow, "requestSymbol" | "provider" | "detail">): SignalAssetClass | null {
  const fromSymbol = inferAssetClassFromSymbol(row.requestSymbol);
  if (fromSymbol) {
    return fromSymbol;
  }

  const detail = String(row.detail ?? "").toLowerCase();
  if (detail.includes("memecoin")) return "memecoin";
  if (detail.includes("index")) return "index";
  if (detail.includes("commodity")) return "commodity";
  if (detail.includes("stock")) return "stock";
  if (detail.includes("crypto")) return "crypto";
  if (detail.includes("forex") || detail.includes("fx")) return "fx";

  const provider = String(row.provider ?? "").toLowerCase();
  if (provider.includes("coingecko")) return "memecoin";
  if (provider.includes("binance")) return "crypto";
  if (provider.includes("stooq")) return "index";
  if (provider.includes("polygon")) return "stock";
  if (provider.includes("yahoo")) return "commodity";
  return null;
}

function buildCacheKey(assetClass: SignalAssetClass | null | undefined, lookbackHours: number): string {
  return `${assetClass ?? "all"}:${lookbackHours}`;
}

export function scoreProviderReliability(input: {
  attempts: number;
  successes: number;
  degradedResponses: number;
  emptyBodyResponses: number;
  averageLatencyMs: number | null;
}): number {
  if (input.attempts === 0) {
    return 0;
  }

  const successRate = input.successes / input.attempts;
  const degradedRate = input.degradedResponses / input.attempts;
  const emptyBodyRate = input.emptyBodyResponses / input.attempts;
  const latencyPenalty = input.averageLatencyMs == null
    ? 8
    : Math.min(22, Math.round(input.averageLatencyMs / 250));

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(successRate * 72 + (1 - degradedRate) * 18 + (1 - emptyBodyRate) * 10 - latencyPenalty),
    ),
  );
}

function toIso(value: Date | null | undefined): string | null {
  return value?.toISOString?.() ?? null;
}

export function summarizeProviderHealthRows(
  rows: ProviderHealthRow[],
  assetClass?: SignalAssetClass,
): ProviderReliabilitySummary[] {
  const grouped = new Map<string, {
    provider: string;
    assetClass: SignalAssetClass;
    attempts: number;
    successes: number;
    degradedResponses: number;
    emptyBodyResponses: number;
    latencySum: number;
    latencyCount: number;
    lastRecordedAt: Date | null;
    lastSuccessfulAt: Date | null;
  }>();

  for (const row of rows) {
    const resolvedAssetClass = inferAssetClassFromRow(row);
    if (!resolvedAssetClass) {
      continue;
    }
    if (assetClass && resolvedAssetClass !== assetClass) {
      continue;
    }

    const key = `${row.provider}:${resolvedAssetClass}`;
    const entry = grouped.get(key) ?? {
      provider: row.provider,
      assetClass: resolvedAssetClass,
      attempts: 0,
      successes: 0,
      degradedResponses: 0,
      emptyBodyResponses: 0,
      latencySum: 0,
      latencyCount: 0,
      lastRecordedAt: null,
      lastSuccessfulAt: null,
    };

    entry.attempts += 1;
    const normalizedStatus = normalizeProviderStatus(row.status);
    if (normalizedStatus === "success") {
      entry.successes += 1;
      if (!entry.lastSuccessfulAt || row.recordedAt > entry.lastSuccessfulAt) {
        entry.lastSuccessfulAt = row.recordedAt;
      }
    }
    if (normalizedStatus === "degraded") {
      entry.degradedResponses += 1;
    }
    if (String(row.detail ?? "").toLowerCase().includes("empty")) {
      entry.emptyBodyResponses += 1;
    }
    if (typeof row.latencyMs === "number" && Number.isFinite(row.latencyMs) && row.latencyMs >= 0) {
      entry.latencySum += row.latencyMs;
      entry.latencyCount += 1;
    }
    if (!entry.lastRecordedAt || row.recordedAt > entry.lastRecordedAt) {
      entry.lastRecordedAt = row.recordedAt;
    }

    grouped.set(key, entry);
  }

  return [...grouped.values()]
    .map(entry => {
      const averageLatencyMs = entry.latencyCount > 0
        ? Math.round(entry.latencySum / entry.latencyCount)
        : null;
      const baseScore = scoreProviderReliability({
        attempts: entry.attempts,
        successes: entry.successes,
        degradedResponses: entry.degradedResponses,
        emptyBodyResponses: entry.emptyBodyResponses,
        averageLatencyMs,
      });
      return {
        provider: entry.provider,
        assetClass: entry.assetClass,
        attempts: entry.attempts,
        successes: entry.successes,
        degradedResponses: entry.degradedResponses,
        emptyBodyResponses: entry.emptyBodyResponses,
        averageLatencyMs,
        successRate: entry.attempts > 0 ? Number((entry.successes / entry.attempts).toFixed(3)) : 0,
        baseScore,
        recentScore: baseScore,
        outcomeSampleSize: 0,
        averageRealizedR: null,
        positiveExpectancyRate: null,
        outcomeAdjustedScore: baseScore,
        lastRecordedAt: toIso(entry.lastRecordedAt),
        lastSuccessfulAt: toIso(entry.lastSuccessfulAt),
      };
    })
    .sort((left, right) => {
      if (right.recentScore !== left.recentScore) {
        return right.recentScore - left.recentScore;
      }
      return right.successRate - left.successRate;
    });
}

type ProviderOutcomeRow = {
  providerAtSignal: string | null;
  assetClass: string;
  realizedRR: number | null;
  createdAt: Date;
};

function normalizeOutcomeAssetClass(value: string | null | undefined): SignalAssetClass | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "forex" || normalized === "fx") return "fx";
  if (normalized === "crypto") return "crypto";
  if (normalized === "stock" || normalized === "stocks" || normalized === "equity") return "stock";
  if (normalized === "commodity" || normalized === "commodities") return "commodity";
  if (normalized === "index" || normalized === "indices") return "index";
  if (normalized === "memecoin") return "memecoin";
  return null;
}

function enrichWithOutcomePerformance(
  summaries: ProviderReliabilitySummary[],
  outcomeRows: ProviderOutcomeRow[],
): ProviderReliabilitySummary[] {
  const outcomesByProvider = new Map<string, ProviderOutcomeRow[]>();

  for (const row of outcomeRows) {
    const assetClass = normalizeOutcomeAssetClass(row.assetClass);
    const provider = String(row.providerAtSignal ?? "").trim();
    if (!assetClass || !provider) {
      continue;
    }

    const key = `${provider.toLowerCase()}:${assetClass}`;
    const bucket = outcomesByProvider.get(key) ?? [];
    bucket.push(row);
    outcomesByProvider.set(key, bucket);
  }

  return summaries.map(summary => {
    const key = `${summary.provider.toLowerCase()}:${summary.assetClass}`;
    const providerOutcomes = outcomesByProvider.get(key) ?? [];
    const rrValues = providerOutcomes
      .map(row => row.realizedRR)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    const averageRealizedR = rrValues.length > 0
      ? Math.round((rrValues.reduce((sum, value) => sum + value, 0) / rrValues.length) * 1000) / 1000
      : null;
    const positiveExpectancyRate = rrValues.length > 0
      ? Math.round((rrValues.filter(value => value > 0).length / rrValues.length) * 1000) / 1000
      : null;
    const outcomeAdjustedScore = computeOutcomeAwareProviderScore({
      baseScore: summary.baseScore,
      sampleSize: rrValues.length,
      averageRealizedR,
      positiveExpectancyRate,
    });

    return {
      ...summary,
      recentScore: outcomeAdjustedScore,
      outcomeSampleSize: rrValues.length,
      averageRealizedR,
      positiveExpectancyRate,
      outcomeAdjustedScore,
    };
  }).sort((left, right) => {
    if (right.recentScore !== left.recentScore) {
      return right.recentScore - left.recentScore;
    }
    return right.successRate - left.successRate;
  });
}

export async function getProviderReliabilitySummaries(input?: {
  assetClass?: SignalAssetClass;
  lookbackHours?: number;
  forceRefresh?: boolean;
}): Promise<ProviderReliabilitySummary[]> {
  const lookbackHours = Math.max(1, input?.lookbackHours ?? 48);
  const cacheKey = buildCacheKey(input?.assetClass, lookbackHours);
  const cached = diagnosticsCache.get(cacheKey);
  if (!input?.forceRefresh && cached && Date.now() - cached.generatedAt < PROVIDER_DIAGNOSTIC_CACHE_TTL_MS) {
    return cached.value;
  }

  const since = new Date(Date.now() - lookbackHours * 60 * 60_000);
  const rows = await prisma.providerHealth.findMany({
    where: {
      recordedAt: {
        gte: since,
      },
    },
    orderBy: {
      recordedAt: "desc",
    },
    take: 2000,
  });
  const outcomeSince = new Date(Date.now() - lookbackHours * 60 * 60_000);
  const outcomeRows = await prisma.tradeOutcome.findMany({
    where: {
      createdAt: {
        gte: outcomeSince,
      },
      providerAtSignal: {
        not: null,
      },
      realizedRR: {
        not: null,
      },
    },
    select: {
      providerAtSignal: true,
      assetClass: true,
      realizedRR: true,
      createdAt: true,
    },
    take: 2000,
    orderBy: {
      createdAt: "desc",
    },
  });

  const summaries = enrichWithOutcomePerformance(
    summarizeProviderHealthRows(rows, input?.assetClass),
    outcomeRows,
  );
  diagnosticsCache.set(cacheKey, {
    value: summaries,
    generatedAt: Date.now(),
  });
  return summaries;
}

export async function rankProviderKeysForAsset(
  assetClass: SignalAssetClass,
  providers: readonly string[],
): Promise<string[]> {
  const summaries = await getProviderReliabilitySummaries({ assetClass });
  const scoreByProvider = new Map(summaries.map(summary => [summary.provider.toLowerCase(), summary.recentScore]));

  return [...providers].sort((left, right) => {
    const rightScore = scoreByProvider.get(right.toLowerCase()) ?? -1;
    const leftScore = scoreByProvider.get(left.toLowerCase()) ?? -1;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return 0;
  });
}
