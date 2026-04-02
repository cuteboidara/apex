import { NextResponse } from "next/server";

import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";
import type { DailySignalSession } from "@/src/infrastructure/config/dailySignals";
import { parseDailySignalBaseWindowKey } from "@/src/infrastructure/config/dailySignals";
import type {
  DailySignalDeliveryRecord,
  DailySignalDeliveryStatus,
} from "@/src/infrastructure/persistence/dailySignalDeliveryRepository";
import type { DailySignalRunRecord } from "@/src/infrastructure/persistence/dailySignalRunRepository";

export type AdminDailyRunDeliveryView = {
  id: string;
  channel: string;
  target: string;
  status: DailySignalDeliveryStatus;
  attempts: number;
  explicitRetry: boolean;
  providerMessageId: string | null;
  errorMessage: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminDailyRunView = {
  id: string;
  windowKey: string;
  baseWindowKey: string;
  runDate: string;
  session: DailySignalSession | null;
  timezone: string;
  scheduledTime: string;
  triggeredBy: string;
  triggerSource: "manual_secret" | "operator";
  status: DailySignalRunRecord["status"];
  forced: boolean;
  dryRun: boolean;
  zeroSignalDay: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  counts: {
    generated: number;
    published: number;
    delivered: number;
    failed: number;
  };
  deliverySummary: {
    total: number;
    queued: number;
    delivering: number;
    delivered: number;
    failed: number;
    skipped: number;
  };
  deliveries: AdminDailyRunDeliveryView[];
  signalPayloadSummary: {
    generatedAt: number | null;
    minimumGrade: string | null;
    allCardsCount: number;
    publishableCardsCount: number;
    hasMarketCommentary: boolean;
  } | null;
};

export async function requireAdminOrOperatorAccess(): Promise<
  | { ok: true; actor: string }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireOperatorSession();
  if (!auth.ok) {
    return {
      ok: false,
      response: auth.response,
    };
  }

  return {
    ok: true,
    actor: auth.session?.user?.email ?? auth.session?.user?.id ?? "operator",
  };
}

function mapDelivery(delivery: DailySignalDeliveryRecord): AdminDailyRunDeliveryView {
  return {
    id: delivery.id,
    channel: delivery.channel,
    target: delivery.target,
    status: delivery.status,
    attempts: delivery.attempts,
    explicitRetry: delivery.explicitRetry,
    providerMessageId: delivery.providerMessageId,
    errorMessage: delivery.errorMessage,
    lastAttemptAt: delivery.lastAttemptAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
  };
}

export function buildAdminDailyRunView(
  run: DailySignalRunRecord,
  deliveries: DailySignalDeliveryRecord[],
): AdminDailyRunView {
  const { session } = parseDailySignalBaseWindowKey(run.baseWindowKey);
  const queued = deliveries.filter(item => item.status === "queued").length;
  const delivering = deliveries.filter(item => item.status === "delivering").length;
  const delivered = deliveries.filter(item => item.status === "delivered").length;
  const failed = deliveries.filter(item => item.status === "failed").length;
  const skipped = deliveries.filter(item => item.status === "skipped").length;

  return {
    id: run.id,
    windowKey: run.windowKey,
    baseWindowKey: run.baseWindowKey,
    runDate: run.runDate,
    session,
    timezone: run.timezone,
    scheduledTime: run.scheduledTime,
    triggeredBy: run.triggeredBy,
    triggerSource: run.triggerSource,
    status: run.status,
    forced: run.forced,
    dryRun: run.dryRun,
    zeroSignalDay: run.zeroSignalDay,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    counts: {
      generated: run.generatedCount,
      published: run.publishedCount,
      delivered,
      failed,
    },
    deliverySummary: {
      total: deliveries.length,
      queued,
      delivering,
      delivered,
      failed,
      skipped,
    },
    deliveries: deliveries.map(mapDelivery),
    signalPayloadSummary: run.signalPayload
      ? {
          generatedAt: run.signalPayload.generatedAt,
          minimumGrade: run.signalPayload.minimumGrade,
          allCardsCount: run.signalPayload.allCardsCount,
          publishableCardsCount: run.signalPayload.publishableCardsCount,
          hasMarketCommentary: Boolean(run.signalPayload.marketCommentary),
        }
      : null,
  };
}
