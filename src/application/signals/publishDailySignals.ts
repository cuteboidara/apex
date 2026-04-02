import { createHash } from "node:crypto";

import { getDailySignalsConfig } from "@/src/infrastructure/config/dailySignals";
import { parseDailySignalBaseWindowKey } from "@/src/infrastructure/config/dailySignals";
import {
  DailySignalDeliveryRepository,
  type DailySignalDeliveryRecord,
} from "@/src/infrastructure/persistence/dailySignalDeliveryRepository";
import {
  DailySignalRunRepository,
  type DailySignalRunRecord,
} from "@/src/infrastructure/persistence/dailySignalRunRepository";
import { TelegramNotificationChannel } from "@/src/infrastructure/notifications/channels/TelegramNotificationChannel";
import type {
  DailySignalDeliveryPayload,
  NotificationChannel,
} from "@/src/infrastructure/notifications/channels/NotificationChannel";

export type PublishDailySignalsResult = {
  run: DailySignalRunRecord;
  deliveries: DailySignalDeliveryRecord[];
  deliveredCount: number;
  failedCount: number;
};

type PublishDailySignalsDependencies = {
  runRepository?: DailySignalRunRepository;
  deliveryRepository?: DailySignalDeliveryRepository;
  getConfig?: typeof getDailySignalsConfig;
  channels?: NotificationChannel[];
};

function hashPayload(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function buildDeliveryPayload(run: DailySignalRunRecord): DailySignalDeliveryPayload {
  const { session } = parseDailySignalBaseWindowKey(run.baseWindowKey);
  return {
    runId: run.id,
    windowKey: run.windowKey,
    runDate: run.runDate,
    session,
    timezone: run.timezone,
    generatedAt: run.signalPayload?.generatedAt ?? Date.now(),
    dryRun: run.dryRun,
    zeroSignalDay: run.zeroSignalDay,
    minimumGrade: run.signalPayload?.minimumGrade ?? "B",
    allSignalCount: run.signalPayload?.allCardsCount ?? 0,
    publishableSignals: run.signalPayload?.cards ?? [],
    marketCommentary: run.signalPayload?.marketCommentary ?? null,
  };
}

export async function publishDailySignals(
  runId: string,
  deps: PublishDailySignalsDependencies = {},
): Promise<PublishDailySignalsResult> {
  const runRepository = deps.runRepository ?? new DailySignalRunRepository();
  const deliveryRepository = deps.deliveryRepository ?? new DailySignalDeliveryRepository();
  const config = await (deps.getConfig ?? getDailySignalsConfig)();
  const run = await runRepository.findById(runId);

  if (!run) {
    throw new Error(`Daily signal run ${runId} not found`);
  }

  const channels = deps.channels ?? (
    config.telegramEnabled
      ? [new TelegramNotificationChannel()]
      : []
  );

  const shouldPublishZeroSignalSummary = run.zeroSignalDay && config.sendZeroSignalSummary;
  const shouldPublishSignals = (run.signalPayload?.cards.length ?? 0) > 0;

  if (!shouldPublishSignals && !shouldPublishZeroSignalSummary) {
    return {
      run,
      deliveries: [],
      deliveredCount: 0,
      failedCount: 0,
    };
  }

  const payload = buildDeliveryPayload(run);
  const payloadHash = hashPayload(payload);
  const deliveries: DailySignalDeliveryRecord[] = [];
  let deliveredCount = 0;
  let failedCount = 0;

  for (const channel of channels) {
    const target = channel.getTarget() ?? channel.channelId;
    const dedupeKey = hashPayload({
      baseWindowKey: run.baseWindowKey,
      channel: channel.channelId,
      target,
      payloadHash,
    });

    const existing = await deliveryRepository.findByDedupeKey(dedupeKey);
    if (existing) {
      deliveries.push(existing);
      if (existing.status === "delivered") {
        deliveredCount += 1;
      }
      if (existing.status === "failed") {
        failedCount += 1;
      }
      continue;
    }

    const createdDelivery = existing ? { record: existing, created: false } : await deliveryRepository.create({
      runId: run.id,
      channel: channel.channelId,
      target,
      dedupeKey,
      payloadHash,
      status: "queued",
      attempts: 0,
      explicitRetry: false,
      providerMessageId: null,
      errorMessage: null,
      payloadSnapshot: payload as unknown as Record<string, unknown>,
    });
    const delivery = createdDelivery.record;

    if (!createdDelivery.created) {
      deliveries.push(delivery);
      if (delivery.status === "delivered") {
        deliveredCount += 1;
      }
      if (delivery.status === "failed") {
        failedCount += 1;
      }
      continue;
    }

    const deliveryAttempt = await deliveryRepository.update(delivery.id, {
      status: "delivering",
      attempts: delivery.attempts + 1,
      lastAttemptAt: new Date(),
      errorMessage: null,
    });

    let result: Awaited<ReturnType<NotificationChannel["send"]>>;
    try {
      result = await channel.send({
        deliveryId: deliveryAttempt.id,
        payload,
        dryRun: run.dryRun,
        explicitRetry: false,
      });
    } catch (error) {
      result = {
        status: "failed",
        target,
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    const updated = await deliveryRepository.update(delivery.id, {
      status: result.status === "delivered"
        ? "delivered"
        : result.status === "failed"
          ? "failed"
          : "skipped",
      deliveredAt: result.status === "delivered" ? new Date() : null,
      providerMessageId: result.providerMessageId ?? null,
      errorMessage: result.status === "failed" ? (result.detail ?? "delivery_failed") : null,
    });

    deliveries.push(updated);
    if (updated.status === "delivered") {
      deliveredCount += 1;
    }
    if (updated.status === "failed") {
      failedCount += 1;
    }
  }

  return {
    run,
    deliveries,
    deliveredCount,
    failedCount,
  };
}
