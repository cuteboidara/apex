import { prisma } from "@/lib/prisma";
import { symbolMatchesAssetClass } from "@/lib/marketData/providerSymbolScope";
import type { AssetClass, ProviderName } from "@/lib/marketData/types";

type HealthScore = {
  provider: ProviderName;
  assetClass: AssetClass;
  score: number;
  state: "HEALTHY" | "DEGRADED" | "UNHEALTHY";
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
  cooldownUntil: string | null;
};

const OPEN_THRESHOLD = 3;
const COOL_DOWN_MS = 5 * 60_000;
const RATE_LIMIT_COOL_DOWN_MS = Number.parseInt(process.env.APEX_PROVIDER_RATE_LIMIT_COOLDOWN_MS ?? "", 10) || 15 * 60_000;
const TIMEOUT_COOL_DOWN_MS = Number.parseInt(process.env.APEX_PROVIDER_TIMEOUT_COOLDOWN_MS ?? "", 10) || 6 * 60_000;
const TEMP_FAILURE_COOL_DOWN_MS = Number.parseInt(process.env.APEX_PROVIDER_TEMP_FAILURE_COOLDOWN_MS ?? "", 10) || 4 * 60_000;

function stateFromScore(score: number): HealthScore["state"] {
  if (score >= 85) return "HEALTHY";
  if (score >= 60) return "DEGRADED";
  return "UNHEALTHY";
}

function classifyFailure(detail: string | null | undefined) {
  const normalized = String(detail ?? "").toLowerCase();
  if (!normalized) {
    return { immediateOpen: false, cooldownMs: COOL_DOWN_MS };
  }

  if (normalized.includes("429") || normalized.includes("rate limit") || normalized.includes("quota")) {
    return { immediateOpen: true, cooldownMs: RATE_LIMIT_COOL_DOWN_MS };
  }

  if (normalized.includes("timeout") || normalized.includes("aborted")) {
    return { immediateOpen: false, cooldownMs: TIMEOUT_COOL_DOWN_MS };
  }

  if (
    normalized.includes("temporary") ||
    normalized.includes("temporarily") ||
    normalized.includes("network") ||
    normalized.includes("connection") ||
    normalized.includes("exception")
  ) {
    return { immediateOpen: false, cooldownMs: TEMP_FAILURE_COOL_DOWN_MS };
  }

  return { immediateOpen: false, cooldownMs: COOL_DOWN_MS };
}

export async function getProviderHealthScore(provider: ProviderName, assetClass: AssetClass): Promise<HealthScore> {
  type ProviderHealthRecord = Awaited<ReturnType<typeof prisma.providerHealth.findMany>>[number];
  const [latestRows, circuit] = await Promise.all([
    prisma.providerHealth.findMany({
      where: { provider, requestSymbol: { not: null } },
      orderBy: { recordedAt: "desc" },
      take: 40,
    }).then(rows => rows.filter((row: ProviderHealthRecord) => symbolMatchesAssetClass(row.requestSymbol, assetClass))).catch(() => []),
    prisma.providerCircuitState.findUnique({
      where: { provider_assetClass: { provider, assetClass } },
    }).catch(() => null),
  ]);

  const sample = latestRows.slice(0, 10);
  const successRate = sample.length === 0 ? 1 : sample.filter((row: (typeof sample)[number]) => row.status === "OK").length / sample.length;
  const degradedRate = sample.length === 0 ? 0 : sample.filter((row: (typeof sample)[number]) => row.status === "DEGRADED").length / sample.length;
  const avgLatency = sample.length === 0 ? 0 : sample.reduce((sum: number, row: (typeof sample)[number]) => sum + (row.latencyMs ?? 0), 0) / sample.length;
  const score = Math.max(0, Math.min(100, Math.round((successRate * 70) + ((1 - degradedRate) * 20) + (avgLatency <= 1200 ? 10 : 0) - ((circuit?.errorStreak ?? 0) * 8))));
  const circuitOpen = circuit?.state === "OPEN" && !!circuit.cooldownUntil && circuit.cooldownUntil.getTime() > Date.now();

  return {
    provider,
    assetClass,
    score,
    state: stateFromScore(score),
    circuitState: circuitOpen ? "OPEN" : circuit?.state === "HALF_OPEN" ? "HALF_OPEN" : "CLOSED",
    cooldownUntil: circuit?.cooldownUntil?.toISOString() ?? null,
  };
}

export async function updateCircuitState(input: {
  provider: ProviderName;
  assetClass: AssetClass;
  success: boolean;
  detail?: string | null;
}) {
  try {
    const current = await prisma.providerCircuitState.findUnique({
      where: { provider_assetClass: { provider: input.provider, assetClass: input.assetClass } },
    });

    const now = new Date();
    const failure = classifyFailure(input.detail);
    const nextFailureCount = input.success ? 0 : (current?.failureCount ?? 0) + 1;
    const nextErrorStreak = input.success ? 0 : (current?.errorStreak ?? 0) + 1;
    const shouldOpen = !input.success && (failure.immediateOpen || nextErrorStreak >= OPEN_THRESHOLD);
    const state = input.success
      ? (current?.state === "OPEN" ? "HALF_OPEN" : "CLOSED")
      : shouldOpen ? "OPEN" : (current?.state ?? "CLOSED");

    await prisma.providerCircuitState.upsert({
      where: { provider_assetClass: { provider: input.provider, assetClass: input.assetClass } },
      create: {
        provider: input.provider,
        assetClass: input.assetClass,
        state,
        failureCount: input.success ? 0 : 1,
        successCount: input.success ? 1 : 0,
        errorStreak: nextErrorStreak,
        openedAt: shouldOpen ? now : null,
        lastFailureAt: input.success ? null : now,
        lastSuccessAt: input.success ? now : null,
        cooldownUntil: shouldOpen ? new Date(now.getTime() + failure.cooldownMs) : null,
      },
      update: {
        state,
        failureCount: nextFailureCount,
        successCount: input.success ? (current?.successCount ?? 0) + 1 : current?.successCount ?? 0,
        errorStreak: nextErrorStreak,
        openedAt: shouldOpen ? now : current?.openedAt,
        lastFailureAt: input.success ? current?.lastFailureAt : now,
        lastSuccessAt: input.success ? now : current?.lastSuccessAt,
        cooldownUntil: shouldOpen ? new Date(now.getTime() + failure.cooldownMs) : input.success ? null : current?.cooldownUntil,
      },
    });
  } catch {
    // circuit state must not break quote paths
  }
}
