import { prisma as _prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = _prisma as any;

export type SniperSignalRow = {
  id: string;
  assetId: string;
  symbol: string;
  setupType: string;
  direction: "long" | "short";
  score: number;
  sweepQuality: number;
  rejection: number;
  structure: number;
  sessionScore: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskReward: number;
  positionSize: number;
  riskUsd: number;
  sweepLevel: number;
  structureLevel: number;
  sessionName: string;
  timeframe: string;
  status: string;
  outcomePrice: number | null;
  outcomePnl: number | null;
  outcomeTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function createSniperSignal(
  data: Omit<SniperSignalRow, "id" | "outcomePrice" | "outcomePnl" | "outcomeTime" | "createdAt" | "updatedAt">,
): Promise<SniperSignalRow> {
  return prisma.sniperSignal.create({ data }) as Promise<SniperSignalRow>;
}

export async function findExistingActiveSignal(assetId: string, sweepLevel: number): Promise<SniperSignalRow | null> {
  const row = await prisma.sniperSignal.findFirst({
    where: {
      assetId,
      sweepLevel,
      status: "ACTIVE",
    },
    orderBy: { createdAt: "desc" },
  });
  return (row as SniperSignalRow | null) ?? null;
}

export async function updateSniperAssetState(data: {
  assetId: string;
  lastScanned: Date;
  lastPrice: number;
  hasActiveSignal: boolean;
  recentSweeps: unknown;
}): Promise<void> {
  await prisma.sniperAssetState.upsert({
    where: { assetId: data.assetId },
    update: {
      lastScanned: data.lastScanned,
      lastPrice: data.lastPrice,
      hasActiveSignal: data.hasActiveSignal,
      recentSweeps: data.recentSweeps,
    },
    create: data,
  });
}

export async function listActiveSniperSignals(): Promise<SniperSignalRow[]> {
  return prisma.sniperSignal.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
  }) as Promise<SniperSignalRow[]>;
}

export async function listRecentClosedSniperSignals(limit = 20): Promise<SniperSignalRow[]> {
  return prisma.sniperSignal.findMany({
    where: { status: { in: ["HIT_TP", "HIT_SL", "EXPIRED", "CLOSED"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  }) as Promise<SniperSignalRow[]>;
}

export async function listActiveForLifecycleChecks(): Promise<SniperSignalRow[]> {
  return prisma.sniperSignal.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  }) as Promise<SniperSignalRow[]>;
}

export async function markSignalOutcome(input: {
  id: string;
  status: "HIT_TP" | "HIT_SL" | "EXPIRED" | "CLOSED";
  outcomePrice?: number;
  outcomePnl?: number;
  outcomeTime?: Date;
}): Promise<void> {
  await prisma.sniperSignal.update({
    where: { id: input.id },
    data: {
      status: input.status,
      outcomePrice: input.outcomePrice ?? null,
      outcomePnl: input.outcomePnl ?? null,
      outcomeTime: input.outcomeTime ?? null,
    },
  });
}

export async function listSniperAssetStates(): Promise<Array<{
  assetId: string;
  lastScanned: Date;
  lastPrice: number;
  hasActiveSignal: boolean;
  recentSweeps: unknown;
  updatedAt: Date;
}>> {
  return prisma.sniperAssetState.findMany({
    orderBy: { assetId: "asc" },
  });
}

export async function calculateSniperStats(): Promise<{
  total: number;
  wins: number;
  losses: number;
  closed: number;
  winRate: number;
  totalPnl: number;
  active: number;
}> {
  const [total, wins, losses, active, pnl] = await Promise.all([
    prisma.sniperSignal.count(),
    prisma.sniperSignal.count({ where: { status: "HIT_TP" } }),
    prisma.sniperSignal.count({ where: { status: "HIT_SL" } }),
    prisma.sniperSignal.count({ where: { status: "ACTIVE" } }),
    prisma.sniperSignal.aggregate({ _sum: { outcomePnl: true } }),
  ]);

  const closed = wins + losses;
  const winRate = closed > 0 ? Math.round((wins / closed) * 1000) / 10 : 0;

  return {
    total,
    wins,
    losses,
    closed,
    winRate,
    totalPnl: pnl?._sum?.outcomePnl ?? 0,
    active,
  };
}

