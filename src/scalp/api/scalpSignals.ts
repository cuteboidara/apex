import { prisma as _prisma } from "@/lib/prisma";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = _prisma as any;

export type ScalpSignalRow = {
  id: string;
  assetId: string;
  symbol: string;
  direction: "long" | "short";
  setupType: string;
  score: number;
  gate1Trend: number;
  gate2Level: number;
  gate3Momentum: number;
  gate4Candle: number;
  gate5Context: number;
  trendAligned: boolean;
  atKeyLevel: boolean;
  momentumOk: boolean;
  candleConfirmed: boolean;
  contextClear: boolean;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  positionSize: number;
  riskUsd: number;
  session: string;
  atrPct: number;
  keyLevelType: string;
  keyLevelPrice: number;
  description: string;
  reasoning: unknown;
  status: string;
  hitTp1At: Date | null;
  hitTp2At: Date | null;
  closedAt: Date | null;
  outcomePnl: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ScalpDiagnosticRow = {
  id: string;
  cycleId: string;
  totalEvaluations: number;
  signalsGenerated: number;
  rejectionByGate: unknown;
  gateResults: unknown;
  createdAt: Date;
};

export async function createScalpSignal(data: Omit<ScalpSignalRow, "id" | "hitTp1At" | "hitTp2At" | "closedAt" | "outcomePnl" | "createdAt" | "updatedAt">): Promise<ScalpSignalRow> {
  return prisma.scalpSignal.create({ data }) as Promise<ScalpSignalRow>;
}

export async function findExistingActiveScalpSignal(assetId: string, direction: "long" | "short", setupType: string): Promise<ScalpSignalRow | null> {
  const row = await prisma.scalpSignal.findFirst({
    where: {
      assetId,
      direction,
      setupType,
      status: "ACTIVE",
    },
    orderBy: { createdAt: "desc" },
  });

  return (row as ScalpSignalRow | null) ?? null;
}

export async function updateScalpAssetState(data: {
  assetId: string;
  lastScanned: Date;
  lastPrice: number;
  hasActiveSignal: boolean;
  trend1h?: string | null;
  trend4h?: string | null;
  currentSession: string;
  atrPct?: number | null;
}): Promise<void> {
  await prisma.scalpAssetState.upsert({
    where: { assetId: data.assetId },
    update: data,
    create: data,
  });
}

export async function listActiveScalpSignals(): Promise<ScalpSignalRow[]> {
  return prisma.scalpSignal.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
  }) as Promise<ScalpSignalRow[]>;
}

export async function listClosedScalpSignals(limit = 20): Promise<ScalpSignalRow[]> {
  return prisma.scalpSignal.findMany({
    where: { status: { in: ["HIT_TP1", "HIT_TP2", "HIT_SL", "EXPIRED"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  }) as Promise<ScalpSignalRow[]>;
}

export async function listActiveScalpForLifecycle(): Promise<ScalpSignalRow[]> {
  return prisma.scalpSignal.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  }) as Promise<ScalpSignalRow[]>;
}

export async function updateScalpSignalStatus(input: {
  id: string;
  status: "ACTIVE" | "HIT_TP1" | "HIT_TP2" | "HIT_SL" | "EXPIRED";
  hitTp1At?: Date | null;
  hitTp2At?: Date | null;
  closedAt?: Date | null;
  outcomePnl?: number | null;
}): Promise<void> {
  await prisma.scalpSignal.update({
    where: { id: input.id },
    data: {
      status: input.status,
      hitTp1At: input.hitTp1At,
      hitTp2At: input.hitTp2At,
      closedAt: input.closedAt,
      outcomePnl: input.outcomePnl,
    },
  });
}

export async function listScalpAssetStates(): Promise<Array<{
  assetId: string;
  lastScanned: Date;
  lastPrice: number;
  hasActiveSignal: boolean;
  trend1h: string | null;
  trend4h: string | null;
  currentSession: string;
  atrPct: number | null;
  updatedAt: Date;
}>> {
  return prisma.scalpAssetState.findMany({ orderBy: { assetId: "asc" } });
}

export async function calculateScalpStats(): Promise<{
  total: number;
  wins: number;
  losses: number;
  closed: number;
  winRate: number;
  active: number;
  totalPnl: number;
}> {
  const [total, wins, losses, active, pnl] = await Promise.all([
    prisma.scalpSignal.count(),
    prisma.scalpSignal.count({ where: { status: { in: ["HIT_TP1", "HIT_TP2"] } } }),
    prisma.scalpSignal.count({ where: { status: "HIT_SL" } }),
    prisma.scalpSignal.count({ where: { status: "ACTIVE" } }),
    prisma.scalpSignal.aggregate({ _sum: { outcomePnl: true } }),
  ]);

  const closed = wins + losses;
  const winRate = closed > 0 ? Math.round((wins / closed) * 1000) / 10 : 0;

  return {
    total,
    wins,
    losses,
    closed,
    winRate,
    active,
    totalPnl: pnl?._sum?.outcomePnl ?? 0,
  };
}

export async function createScalpDiagnostic(data: {
  cycleId: string;
  totalEvaluations: number;
  signalsGenerated: number;
  rejectionByGate: unknown;
  gateResults: unknown;
}): Promise<ScalpDiagnosticRow> {
  return prisma.scalpDiagnostic.create({ data }) as Promise<ScalpDiagnosticRow>;
}

export async function listScalpDiagnostics(limit = 20): Promise<ScalpDiagnosticRow[]> {
  return prisma.scalpDiagnostic.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  }) as Promise<ScalpDiagnosticRow[]>;
}
