import type { SignalLog } from "@prisma/client";

import type { SignalLifecycleRecord } from "@/src/interfaces/contracts";
import type { TraderDashboardSignal } from "@/src/lib/traderContracts";

type SignalOutcomeValue = "stopped_out" | "hit_tp1" | "hit_tp2" | "hit_tp3" | "expired" | "cancelled";

function hasDatabaseConfig(): boolean {
  const url = process.env.DATABASE_URL?.trim() || process.env.DIRECT_DATABASE_URL?.trim();
  return Boolean(url);
}

async function getPrismaClient() {
  if (!hasDatabaseConfig()) {
    return null;
  }

  const { prisma } = await import("@/lib/prisma");
  return prisma;
}

function parseNullableFloat(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function resolveStoredDirection(card: TraderDashboardSignal): "buy" | "sell" | "neutral" {
  if (card.direction === "long") {
    return "buy";
  }
  if (card.direction === "short") {
    return "sell";
  }
  return "neutral";
}

function resolveLifecycleOutcome(lifecycle: SignalLifecycleRecord | null | undefined): SignalOutcomeValue | null {
  switch (lifecycle?.state) {
    case "stopped_out":
      return "stopped_out";
    case "tp1_hit":
      return "hit_tp1";
    case "tp2_hit":
      return "hit_tp2";
    case "tp3_hit":
      return "hit_tp3";
    case "expired":
      return "expired";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

function resolveOutcomePrice(
  lifecycle: SignalLifecycleRecord | null | undefined,
  outcome: SignalOutcomeValue | null,
): number | null {
  if (!lifecycle || !outcome) {
    return null;
  }

  switch (outcome) {
    case "stopped_out":
      return parseNullableFloat(lifecycle.sl);
    case "hit_tp1":
      return parseNullableFloat(lifecycle.tp1);
    case "hit_tp2":
      return parseNullableFloat(lifecycle.tp2);
    case "hit_tp3":
      return parseNullableFloat(lifecycle.tp3);
    case "expired":
    case "cancelled":
      return parseNullableFloat(lifecycle.entry);
    default:
      return null;
  }
}

function resolveOutcomeAt(lifecycle: SignalLifecycleRecord | null | undefined): Date | null {
  const ts = lifecycle?.completed_ts ?? lifecycle?.updated_ts ?? null;
  return ts == null ? null : new Date(ts);
}

export async function logSignalEmission(card: TraderDashboardSignal, cycleId?: string): Promise<void> {
  const prisma = await getPrismaClient();
  if (!prisma) {
    return;
  }

  const outcome = resolveLifecycleOutcome(card.latestLifecycle);
  const outcomePrice = resolveOutcomePrice(card.latestLifecycle, outcome);
  const outcomeAt = resolveOutcomeAt(card.latestLifecycle);

  try {
    await prisma.signalLog.create({
      data: {
        symbol: card.symbol,
        direction: resolveStoredDirection(card),
        grade: card.grade,
        status: card.status,
        setupType: card.setupType,
        session: card.session,
        bias: card.bias,
        confidence: parseNullableFloat(card.confidence),
        entry: parseNullableFloat(card.entry),
        sl: parseNullableFloat(card.sl),
        tp1: parseNullableFloat(card.tp1),
        tp2: parseNullableFloat(card.tp2),
        tp3: parseNullableFloat(card.tp3),
        livePrice: parseNullableFloat(card.livePrice),
        noTradeReason: card.noTradeReason,
        shortReasoning: card.shortReasoning,
        marketPhase: card.marketPhase,
        location: card.location,
        zoneType: card.zoneType,
        podVoteSummary: card.podVoteSummary ? JSON.stringify(card.podVoteSummary) : null,
        blockedReasons: card.blockedReasons.length > 0 ? JSON.stringify(card.blockedReasons) : null,
        cycleId: cycleId ?? null,
        outcome,
        outcomeAt,
        outcomePrice,
      },
    });
  } catch (error) {
    console.error("[signalLogger] Failed to log signal emission:", error);
  }
}

export async function updateSignalOutcome(
  signalLogId: string,
  outcome: SignalOutcomeValue,
  outcomePrice?: number,
): Promise<void> {
  const prisma = await getPrismaClient();
  if (!prisma) {
    return;
  }

  try {
    await prisma.signalLog.update({
      where: { id: signalLogId },
      data: {
        outcome,
        outcomeAt: new Date(),
        outcomePrice: outcomePrice ?? null,
      },
    });
  } catch (error) {
    console.error("[signalLogger] Failed to update signal outcome:", error);
  }
}

export async function getRecentSignalLogs(
  symbol?: string,
  limit = 50,
): Promise<SignalLog[]> {
  const prisma = await getPrismaClient();
  if (!prisma) {
    return [];
  }

  try {
    return await prisma.signalLog.findMany({
      where: symbol ? { symbol } : {},
      orderBy: { emittedAt: "desc" },
      take: limit,
    });
  } catch (error) {
    console.error("[signalLogger] Failed to read recent signal logs:", error);
    return [];
  }
}
