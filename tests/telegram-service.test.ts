import assert from "node:assert/strict";
import test from "node:test";

import { createTelegramService } from "@/lib/telegramService";

test("telegram service records failed delivery attempts when channel and subscriber sends fail", async () => {
  const alerts: Array<{ status: string; failureReason?: string | null }> = [];
  const deliveryAttempts: Array<{ status: string; detail?: string | null }> = [];
  const metrics: string[] = [];
  const audits: string[] = [];

  const service = createTelegramService({
    prisma: {
      telegramSettings: {
        findFirst: async () => ({
          id: "settings_1",
          enabled: true,
          minRank: "B",
          allowedAssets: "ALL",
          weekendCryptoOnly: false,
        }),
        create: async () => ({
          id: "settings_1",
          enabled: true,
          minRank: "B",
          allowedAssets: "ALL",
          weekendCryptoOnly: false,
        }),
        update: async () => ({ id: "settings_1", enabled: false }),
      },
      telegramSubscriber: {
        findMany: async () => ([
          { chatId: "sub_1", alertAssets: [], alertRanks: ["B"] },
        ]),
      },
      alert: {
        create: async () => ({ id: "alert_1" }),
        update: async ({ data }: { data: Record<string, unknown> }) => {
          alerts.push({
            status: String(data.status),
            failureReason: typeof data.failureReason === "string" ? data.failureReason : null,
          });
          return { id: "alert_1" };
        },
        findMany: async () => [],
      },
      alertDeliveryAttempt: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          deliveryAttempts.push({
            status: String(data.status),
            detail: typeof data.detail === "string" ? data.detail : null,
          });
          return { id: "attempt_1" };
        },
      },
      signal: {
        update: async () => ({ id: "signal_1" }),
      },
    } as never,
    logEvent: () => undefined,
    recordAuditEvent: async input => {
      audits.push(input.action);
    },
    recordOperationalMetric: async input => {
      metrics.push(input.metric);
    },
    sendSignalAlert: async () => false,
    postToTelegram: async () => false,
    botToken: "token",
    chatId: "channel_1",
  });

  await service.sendSignal({
    id: "signal_1",
    runId: "run_1",
    asset: "EURUSD",
    direction: "LONG",
    rank: "A",
    total: 84,
    entry: 1.1,
    stopLoss: 1.09,
    tp1: 1.11,
    tp2: 1.12,
    tp3: 1.13,
    brief: "Test signal",
    createdAt: new Date("2026-03-23T00:00:00.000Z"),
  });

  assert.equal(alerts.at(-1)?.status, "FAILED");
  assert.match(alerts.at(-1)?.failureReason ?? "", /Telegram API request failed/);
  assert.equal(deliveryAttempts.at(-1)?.status, "FAILED");
  assert.ok(metrics.includes("telegram_delivery_failure"));
  assert.deepEqual(audits.slice(-2), ["alert_queued", "alert_failed"]);
});
