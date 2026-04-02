import {
  parseDailySignalBaseWindowKey,
} from "@/src/infrastructure/config/dailySignals";
import {
  DailySignalDeliveryRepository,
  type DailySignalDeliveryRecord,
} from "@/src/infrastructure/persistence/dailySignalDeliveryRepository";
import { DailySignalRunRepository } from "@/src/infrastructure/persistence/dailySignalRunRepository";
import { TelegramNotificationChannel } from "@/src/infrastructure/notifications/channels/TelegramNotificationChannel";
import type {
  DailySignalDeliveryPayload,
  NotificationChannel,
} from "@/src/infrastructure/notifications/channels/NotificationChannel";

type RetryDailySignalDeliveryDependencies = {
  runRepository?: DailySignalRunRepository;
  deliveryRepository?: DailySignalDeliveryRepository;
  channels?: NotificationChannel[];
};

function buildPayloadFromRun(run: Awaited<ReturnType<DailySignalRunRepository["findById"]>>): DailySignalDeliveryPayload {
  if (!run) {
    throw new Error("Daily signal run not found");
  }

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

export async function retryDailySignalDelivery(
  deliveryId: string,
  deps: RetryDailySignalDeliveryDependencies = {},
): Promise<DailySignalDeliveryRecord> {
  const runRepository = deps.runRepository ?? new DailySignalRunRepository();
  const deliveryRepository = deps.deliveryRepository ?? new DailySignalDeliveryRepository();
  const delivery = await deliveryRepository.findById(deliveryId);

  if (!delivery) {
    throw new Error(`Daily signal delivery ${deliveryId} not found`);
  }

  const run = await runRepository.findById(delivery.runId);
  if (!run) {
    throw new Error(`Daily signal run ${delivery.runId} not found`);
  }

  const channels = deps.channels ?? [new TelegramNotificationChannel()];
  const channel = channels.find(item => item.channelId === delivery.channel);
  if (!channel) {
    throw new Error(`Notification channel ${delivery.channel} is not registered`);
  }

  const updatedDelivery = await deliveryRepository.update(delivery.id, {
    status: "delivering",
    attempts: delivery.attempts + 1,
    explicitRetry: true,
    lastAttemptAt: new Date(),
    errorMessage: null,
  });

  let result: Awaited<ReturnType<NotificationChannel["send"]>>;
  try {
    result = await channel.send({
      deliveryId: updatedDelivery.id,
      payload: buildPayloadFromRun(run),
      dryRun: run.dryRun,
      explicitRetry: true,
    });
  } catch (error) {
    result = {
      status: "failed",
      target: delivery.target,
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  return deliveryRepository.update(delivery.id, {
    status: result.status === "delivered"
      ? "delivered"
      : result.status === "failed"
        ? "failed"
        : "skipped",
    deliveredAt: result.status === "delivered" ? new Date() : null,
    providerMessageId: result.providerMessageId ?? null,
    errorMessage: result.status === "failed" ? (result.detail ?? "retry_failed") : null,
  });
}
