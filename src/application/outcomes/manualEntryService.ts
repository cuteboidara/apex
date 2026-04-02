import { prisma } from "@/lib/prisma";
import { createId } from "@/src/lib/ids";
import { resolveOutcomeDataQuality } from "@/src/assets/shared/providerHealth";

export type ManualOutcomeEntryInput = {
  tradePlanId?: string | null;
  signalId?: string | null;
  outcome:
    | "INVALIDATED"
    | "STOP"
    | "STOP_AFTER_TP1"
    | "STOP_AFTER_TP2"
    | "TP1"
    | "TP2"
    | "TP3"
    | "EXPIRED";
  occurredAt?: Date;
  realizedRR?: number | null;
  note?: string | null;
};

export async function applyManualOutcomeEntry(input: ManualOutcomeEntryInput) {
  const occurredAt = input.occurredAt ?? new Date();

  const tradePlan = input.tradePlanId
    ? await prisma.tradePlan.findUnique({
      where: { id: input.tradePlanId },
      include: { signal: true },
    })
    : input.signalId
      ? await prisma.tradePlan.findFirst({
        where: { signalId: input.signalId },
        orderBy: { createdAt: "desc" },
        include: { signal: true },
      })
      : null;

  if (!tradePlan) {
    throw new Error("manual_outcome_trade_plan_not_found");
  }

  const updateData: Record<string, unknown> = {
    outcome: input.outcome,
  };

  if (input.outcome === "INVALIDATED") {
    updateData.invalidatedAt = occurredAt;
  }
  if (input.outcome === "EXPIRED") {
    updateData.expiredAt = occurredAt;
  }
  if (input.outcome === "TP1" || input.outcome === "STOP_AFTER_TP1" || input.outcome === "STOP_AFTER_TP2" || input.outcome === "TP2" || input.outcome === "TP3") {
    updateData.entryHitAt = tradePlan.entryHitAt ?? occurredAt;
    updateData.tp1HitAt = tradePlan.tp1HitAt ?? occurredAt;
  }
  if (input.outcome === "TP2" || input.outcome === "STOP_AFTER_TP2" || input.outcome === "TP3") {
    updateData.tp2HitAt = tradePlan.tp2HitAt ?? occurredAt;
  }
  if (input.outcome === "TP3") {
    updateData.tp3HitAt = tradePlan.tp3HitAt ?? occurredAt;
  }
  if (input.outcome === "STOP" || input.outcome === "STOP_AFTER_TP1" || input.outcome === "STOP_AFTER_TP2") {
    updateData.entryHitAt = tradePlan.entryHitAt ?? occurredAt;
    updateData.stopHitAt = occurredAt;
  }
  if (typeof input.realizedRR === "number" && Number.isFinite(input.realizedRR)) {
    updateData.realizedRR = input.realizedRR;
  }

  const updatedPlan = await prisma.tradePlan.update({
    where: { id: tradePlan.id },
    data: updateData,
  });

  const dataQuality = resolveOutcomeDataQuality({
    providerStatus: tradePlan.providerHealthStateAtSignal === "HEALTHY"
      ? "healthy"
      : tradePlan.providerFallbackUsedAtSignal
        ? "fallback"
        : "degraded",
    fallbackUsed: tradePlan.providerFallbackUsedAtSignal,
    manual: true,
  });

  await prisma.tradeOutcome.upsert({
    where: { tradePlanId: tradePlan.id },
    create: {
      tradePlanId: tradePlan.id,
      signalId: tradePlan.signalId,
      runId: tradePlan.runId,
      symbol: tradePlan.symbol,
      assetClass: tradePlan.assetClass,
      style: tradePlan.style,
      setupFamily: tradePlan.setupFamily,
      bias: tradePlan.bias,
      confidence: tradePlan.confidence,
      providerAtSignal: tradePlan.providerAtSignal,
      providerHealthStateAtSignal: tradePlan.providerHealthStateAtSignal,
      regimeTag: tradePlan.regimeTag,
      outcome: input.outcome,
      entryPrice: tradePlan.entryMin ?? tradePlan.entryMax,
      exitPrice: input.outcome === "STOP" || input.outcome === "STOP_AFTER_TP1" || input.outcome === "STOP_AFTER_TP2"
        ? tradePlan.stopLoss
        : input.outcome === "TP3"
          ? tradePlan.takeProfit3
          : input.outcome === "TP2"
            ? tradePlan.takeProfit2
            : tradePlan.takeProfit1,
      realizedPnl: updatedPlan.realizedRR,
      realizedRR: updatedPlan.realizedRR,
      maxFavorableExcursion: updatedPlan.maxFavorableExcursion,
      maxAdverseExcursion: updatedPlan.maxAdverseExcursion,
      openedAt: updatedPlan.detectedAt,
      closedAt: occurredAt,
      metadata: {
        manual: true,
        note: input.note ?? null,
        dataQuality,
        projectedRiskReward: tradePlan.riskRewardRatio,
        realizedRiskReward: updatedPlan.realizedRR,
        sweepBeforeEntry: (tradePlan.executionNotes ?? "").includes("sweep_before_entry=true"),
        targetHit: input.outcome === "TP3"
          ? "TP3"
          : input.outcome === "TP2" || input.outcome === "STOP_AFTER_TP2"
            ? "TP2"
            : input.outcome === "TP1" || input.outcome === "STOP_AFTER_TP1"
              ? "TP1"
              : "NONE",
      },
    },
    update: {
      outcome: input.outcome,
      realizedPnl: updatedPlan.realizedRR,
      realizedRR: updatedPlan.realizedRR,
      openedAt: updatedPlan.detectedAt,
      closedAt: occurredAt,
      metadata: {
        manual: true,
        note: input.note ?? null,
        dataQuality,
        projectedRiskReward: tradePlan.riskRewardRatio,
        realizedRiskReward: updatedPlan.realizedRR,
        sweepBeforeEntry: (tradePlan.executionNotes ?? "").includes("sweep_before_entry=true"),
        targetHit: input.outcome === "TP3"
          ? "TP3"
          : input.outcome === "TP2" || input.outcome === "STOP_AFTER_TP2"
            ? "TP2"
            : input.outcome === "TP1" || input.outcome === "STOP_AFTER_TP1"
              ? "TP1"
              : "NONE",
      },
    },
  });

  await prisma.systemEvent.create({
    data: {
      eventId: createId("sysevt"),
      ts: occurredAt,
      module: "manual-outcome",
      type: "manual_outcome_recorded",
      reason: input.outcome,
      payload: {
        tradePlanId: tradePlan.id,
        signalId: tradePlan.signalId,
        symbol: tradePlan.symbol,
        assetClass: tradePlan.assetClass,
        note: input.note ?? null,
      },
    },
  }).catch(() => undefined);

  return {
    tradePlanId: tradePlan.id,
    signalId: tradePlan.signalId,
    outcome: input.outcome,
    realizedRR: updatedPlan.realizedRR,
    occurredAt: occurredAt.toISOString(),
  };
}
