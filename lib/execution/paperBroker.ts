import { prisma } from "@/lib/prisma";
import { recordOperationalMetric } from "@/lib/observability/metrics";
import { applyExecutionFriction, calculatePositionPnl, calculateRiskBasedQuantity } from "@/lib/execution/positionManager";

function midpoint(min: number | null, max: number | null) {
  if (min == null && max == null) return null;
  if (min == null) return max;
  if (max == null) return min;
  return (min + max) / 2;
}

async function refreshAccountEquity(accountId: string) {
  const [account, openPositions] = await Promise.all([
    prisma.paperAccount.findUnique({ where: { id: accountId } }),
    prisma.paperPosition.findMany({
      where: { accountId, status: "OPEN" },
      select: { unrealizedPnl: true },
    }),
  ]);

  if (!account) {
    throw new Error("Paper account not found.");
  }

  const unrealized = openPositions.reduce((sum, position) => sum + (position.unrealizedPnl ?? 0), 0);
  const equity = account.cashBalance + unrealized;

  return prisma.paperAccount.update({
    where: { id: accountId },
    data: { equity },
  });
}

export async function getOrCreatePaperAccount(input?: {
  ownerUserId?: string | null;
  name?: string;
}) {
  const existing = await prisma.paperAccount.findFirst({
    where: {
      ownerUserId: input?.ownerUserId ?? null,
      isDefault: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing;
  }

  return prisma.paperAccount.create({
    data: {
      ownerUserId: input?.ownerUserId ?? null,
      name: input?.name ?? "Primary Paper Account",
      isDefault: true,
    },
  });
}

export async function listPaperAccounts(ownerUserId?: string | null) {
  return prisma.paperAccount.findMany({
    where: { ownerUserId: ownerUserId ?? null },
    orderBy: { createdAt: "asc" },
  });
}

export async function openPaperPositionFromTradePlan(input: {
  tradePlanId: string;
  ownerUserId?: string | null;
  accountId?: string | null;
  quantity?: number | null;
  riskFraction?: number;
  spreadBps?: number;
  slippageBps?: number;
}) {
  const [tradePlan, account] = await Promise.all([
    prisma.tradePlan.findUnique({ where: { id: input.tradePlanId } }),
    input.accountId
      ? prisma.paperAccount.findUnique({ where: { id: input.accountId } })
      : getOrCreatePaperAccount({ ownerUserId: input.ownerUserId ?? null }),
  ]);

  if (!tradePlan) {
    throw new Error("Trade plan not found.");
  }
  if (!account) {
    throw new Error("Paper account not found.");
  }
  if (tradePlan.status !== "ACTIVE") {
    throw new Error("Only ACTIVE trade plans can be executed in paper mode.");
  }

  const baseEntry = midpoint(tradePlan.entryMin, tradePlan.entryMax);
  if (baseEntry == null) {
    throw new Error("Trade plan entry is missing.");
  }

  const entryPrice = applyExecutionFriction({
    price: baseEntry,
    direction: tradePlan.bias as "LONG" | "SHORT",
    side: "ENTRY",
    spreadBps: input.spreadBps,
    slippageBps: input.slippageBps,
  });
  const quantity = input.quantity && input.quantity > 0
    ? input.quantity
    : calculateRiskBasedQuantity({
        accountEquity: account.equity,
        riskFraction: input.riskFraction,
        entryPrice,
        stopLoss: tradePlan.stopLoss,
      });

  const created = await prisma.$transaction(async tx => {
    const position = await tx.paperPosition.create({
      data: {
        accountId: account.id,
        tradePlanId: tradePlan.id,
        signalId: tradePlan.signalId,
        symbol: tradePlan.symbol,
        assetClass: tradePlan.assetClass,
        status: "OPEN",
        direction: tradePlan.bias,
        quantity,
        entryPrice,
        stopLoss: tradePlan.stopLoss,
        takeProfit1: tradePlan.takeProfit1,
        takeProfit2: tradePlan.takeProfit2,
        takeProfit3: tradePlan.takeProfit3,
        currentPrice: entryPrice,
        unrealizedPnl: 0,
      },
    });

    const fill = await tx.executionFill.create({
      data: {
        accountId: account.id,
        positionId: position.id,
        tradePlanId: tradePlan.id,
        signalId: tradePlan.signalId,
        symbol: tradePlan.symbol,
        assetClass: tradePlan.assetClass,
        side: tradePlan.bias === "LONG" ? "BUY" : "SELL",
        quantity,
        price: entryPrice,
        slippageBps: input.slippageBps ?? 0,
        spreadBps: input.spreadBps ?? 0,
        mode: "PAPER",
        venue: "SIMULATED",
        provider: tradePlan.providerAtSignal,
      },
    });

    return { position, fill };
  });

  await refreshAccountEquity(account.id);
  await recordOperationalMetric({
    metric: "paper_position_opened",
    category: "execution",
    severity: "INFO",
    count: 1,
    symbol: tradePlan.symbol,
    assetClass: tradePlan.assetClass,
    runId: tradePlan.runId,
    detail: `Paper position opened for ${tradePlan.symbol}`,
    tags: {
      tradePlanId: tradePlan.id,
      accountId: account.id,
      positionId: created.position.id,
    },
  });

  return { accountId: account.id, ...created };
}

export async function markPaperPosition(input: {
  positionId: string;
  currentPrice: number;
}) {
  const position = await prisma.paperPosition.findUnique({
    where: { id: input.positionId },
  });
  if (!position) {
    throw new Error("Paper position not found.");
  }
  if (position.status !== "OPEN") {
    throw new Error("Only OPEN positions can be marked to market.");
  }

  const unrealizedPnl = calculatePositionPnl(
    position.direction as "LONG" | "SHORT",
    position.entryPrice,
    input.currentPrice,
    position.quantity
  );

  const updated = await prisma.paperPosition.update({
    where: { id: position.id },
    data: {
      currentPrice: input.currentPrice,
      unrealizedPnl,
    },
  });

  await refreshAccountEquity(position.accountId);
  return updated;
}

export async function closePaperPosition(input: {
  positionId: string;
  exitPrice: number;
  spreadBps?: number;
  slippageBps?: number;
}) {
  const position = await prisma.paperPosition.findUnique({
    where: { id: input.positionId },
  });
  if (!position) {
    throw new Error("Paper position not found.");
  }
  if (position.status !== "OPEN") {
    throw new Error("Position is already closed.");
  }

  const exitPrice = applyExecutionFriction({
    price: input.exitPrice,
    direction: position.direction as "LONG" | "SHORT",
    side: "EXIT",
    spreadBps: input.spreadBps,
    slippageBps: input.slippageBps,
  });
  const realizedPnl = calculatePositionPnl(
    position.direction as "LONG" | "SHORT",
    position.entryPrice,
    exitPrice,
    position.quantity
  );

  const closed = await prisma.$transaction(async tx => {
    const updatedPosition = await tx.paperPosition.update({
      where: { id: position.id },
      data: {
        status: "CLOSED",
        currentPrice: exitPrice,
        unrealizedPnl: 0,
        realizedPnl,
        closedAt: new Date(),
      },
    });

    await tx.executionFill.create({
      data: {
        accountId: position.accountId,
        positionId: position.id,
        tradePlanId: position.tradePlanId,
        signalId: position.signalId,
        symbol: position.symbol,
        assetClass: position.assetClass,
        side: position.direction === "LONG" ? "SELL" : "BUY",
        quantity: position.quantity,
        price: exitPrice,
        slippageBps: input.slippageBps ?? 0,
        spreadBps: input.spreadBps ?? 0,
        mode: "PAPER",
        venue: "SIMULATED",
      },
    });

    await tx.paperAccount.update({
      where: { id: position.accountId },
      data: {
        cashBalance: { increment: realizedPnl },
      },
    });

    return updatedPosition;
  });

  await refreshAccountEquity(position.accountId);
  await recordOperationalMetric({
    metric: "paper_position_closed",
    category: "execution",
    severity: "INFO",
    count: 1,
    symbol: position.symbol,
    assetClass: position.assetClass,
    detail: `Paper position closed for ${position.symbol}`,
    tags: {
      positionId: position.id,
      accountId: position.accountId,
      realizedPnl,
    },
  });

  return closed;
}
