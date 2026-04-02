// DEPRECATED: Use src/lib/telegram.ts for all active signal delivery.
/**
 * @deprecated LEGACY — Not used by the focused APEX runtime.
 * This file is retained to avoid breaking legacy routes during transition.
 * Do not add new imports of this file.
 */
import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logging";
import { recordAuditEvent } from "@/lib/audit";
import { recordOperationalMetric } from "@/lib/observability/metrics";
import { sendSignalAlert } from "@/lib/telegram/bot";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID ?? "";

// ── Rank ordering ─────────────────────────────────────────────────────────────

const RANK_ORDER: Record<string, number> = { S: 3, A: 2, B: 1, Silent: 0 };

function rankMeetsMinimum(rank: string, minRank: string): boolean {
  return (RANK_ORDER[rank] ?? 0) >= (RANK_ORDER[minRank] ?? 0);
}

const WEEKEND_CRYPTO = new Set(["BTCUSDT", "ETHUSDT"]);

type SignalRecord = {
  id: string;
  runId: string;
  asset: string;
  direction: string;
  rank: string;
  total: number;
  entry: number | null;
  stopLoss: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  brief: string;
  createdAt: Date;
};

// ── Format message ────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 4): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toFixed(decimals);
}

function formatSignalMessage(signal: SignalRecord): string {
  const ts = new Date(signal.createdAt).toUTCString();
  const dir = signal.direction === "LONG" ? "📈 LONG" : "📉 SHORT";

  return [
    `🔥 <b>APEX SIGNAL — ${signal.rank}</b>`,
    ``,
    `📊 <b>${signal.asset}</b> | ${dir}`,
    `⚡ Score: <b>${signal.total}/100</b>`,
    ``,
    `💰 Entry: <b>${fmt(signal.entry)}</b>`,
    `🛑 Stop Loss: <b>${fmt(signal.stopLoss)}</b>`,
    `🎯 TP1: <b>${fmt(signal.tp1)}</b> | TP2: <b>${fmt(signal.tp2)}</b> | TP3: <b>${fmt(signal.tp3)}</b>`,
    ``,
    `📝 ${signal.brief}`,
    ``,
    `⏰ ${ts}`,
  ].join("\n");
}

// ── Send to Telegram ──────────────────────────────────────────────────────────

async function postToTelegram(text: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

type TelegramServiceDependencies = {
  prisma: typeof prisma;
  logEvent: typeof logEvent;
  recordAuditEvent: typeof recordAuditEvent;
  recordOperationalMetric: typeof recordOperationalMetric;
  sendSignalAlert: typeof sendSignalAlert;
  postToTelegram: (text: string) => Promise<boolean>;
  botToken: string;
  chatId: string;
};

export function createTelegramService(deps: TelegramServiceDependencies) {
  async function getSettings() {
    let settings = await deps.prisma.telegramSettings.findFirst();
    if (!settings) {
      settings = await deps.prisma.telegramSettings.create({ data: {} });
    }
    return settings;
  }

  async function sendSignal(signal: SignalRecord): Promise<void> {
    const settings = await getSettings();

    const queuedAlert = await deps.prisma.alert.create({
      data: {
        signalId: signal.id,
        channel: "TELEGRAM",
        recipient: deps.chatId || "UNCONFIGURED",
        status: "QUEUED",
        retryCount: 0,
      },
    });
    await deps.recordAuditEvent({
      actor: "SYSTEM",
      action: "alert_queued",
      entityType: "Alert",
      entityId: queuedAlert.id,
      after: { signalId: signal.id, channel: "TELEGRAM" },
      correlationId: signal.runId,
    });

    if (!settings.enabled) {
      await deps.prisma.alert.update({
        where: { id: queuedAlert.id },
        data: { status: "SKIPPED", failureReason: "Telegram alerts disabled" },
      });
      return;
    }

    const message = formatSignalMessage(signal);
    const attemptedAt = new Date();
    const deliveryStartedAt = Date.now();

    const channelRankOk = rankMeetsMinimum(signal.rank, settings.minRank);
    const channelAssetOk = settings.allowedAssets === "ALL" ||
      settings.allowedAssets.split(",").map(s => s.trim()).includes(signal.asset);
    const channelWeekendOk = !settings.weekendCryptoOnly || (() => {
      const day = new Date().getDay();
      return (day !== 0 && day !== 6) || WEEKEND_CRYPTO.has(signal.asset);
    })();
    const channelEligible = channelRankOk && channelAssetOk && channelWeekendOk;

    const subscribers = await deps.prisma.telegramSubscriber.findMany({
      where: { status: "ACTIVE", alertsEnabled: true },
      select: { chatId: true, alertAssets: true, alertRanks: true },
    });

    const eligibleSubs = subscribers.filter(sub => {
      if (sub.alertAssets.length > 0 && !sub.alertAssets.includes(signal.asset)) return false;
      const minRank = sub.alertRanks.length > 0
        ? sub.alertRanks.reduce((best, rank) => (RANK_ORDER[rank] ?? 0) < (RANK_ORDER[best] ?? 0) ? rank : best, sub.alertRanks[0])
        : "B";
      return (RANK_ORDER[signal.rank] ?? 0) >= (RANK_ORDER[minRank] ?? 0);
    });

    const channelPromise = channelEligible && deps.botToken && deps.chatId
      ? deps.postToTelegram(message)
      : Promise.resolve(false);

    const [channelSent, ...subResults] = await Promise.allSettled([
      channelPromise,
      ...eligibleSubs.map(sub => deps.sendSignalAlert(sub.chatId, signal)),
    ]);

    const sent = channelSent.status === "fulfilled" && channelSent.value;
    const subsSent = subResults.filter(result => result.status === "fulfilled" && (result as PromiseFulfilledResult<boolean>).value).length;

    if (subsSent > 0 || sent) {
      if (subsSent > 0) {
        console.log(`[APEX:telegram] Fan-out delivered to ${subsSent}/${eligibleSubs.length} subscribers for ${signal.asset}`);
      }
      await deps.prisma.alert.update({
        where: { id: queuedAlert.id },
        data: {
          status: "DELIVERED",
          attemptedAt,
          deliveredAt: new Date(),
        },
      });
      await deps.prisma.alertDeliveryAttempt.create({
        data: {
          alertId: queuedAlert.id,
          channel: "TELEGRAM",
          recipient: sent ? deps.chatId || "CHANNEL" : `subscribers:${eligibleSubs.length}`,
          status: "DELIVERED",
          latencyMs: Date.now() - deliveryStartedAt,
          detail: `channel=${sent}; subscribers=${subsSent}/${eligibleSubs.length}`,
        },
      }).catch(() => undefined);
      await deps.prisma.signal.update({
        where: { id: signal.id },
        data: { sentTelegram: true },
      });
      await deps.recordOperationalMetric({
        metric: "telegram_delivery_success",
        category: "alert",
        severity: "INFO",
        count: 1,
        runId: signal.runId,
        symbol: signal.asset,
        value: Date.now() - deliveryStartedAt,
        unit: "ms",
        detail: `channel=${sent}; subscribers=${subsSent}/${eligibleSubs.length}`,
      });
      deps.logEvent({
        component: "alert-worker",
        runId: signal.runId,
        asset: signal.asset,
        message: `Telegram alert delivered (channel: ${sent}, subscribers: ${subsSent}/${eligibleSubs.length})`,
        signalId: signal.id,
      });
      await deps.recordAuditEvent({
        actor: "SYSTEM",
        action: "alert_sent",
        entityType: "Alert",
        entityId: queuedAlert.id,
        after: { signalId: signal.id, status: "DELIVERED", subsSent },
        correlationId: signal.runId,
      });
      return;
    }

    await deps.prisma.alert.update({
      where: { id: queuedAlert.id },
      data: {
        status: "FAILED",
        attemptedAt,
        failureReason: "Telegram API request failed",
        retryCount: { increment: 1 },
      },
    });
    await deps.prisma.alertDeliveryAttempt.create({
      data: {
        alertId: queuedAlert.id,
        channel: "TELEGRAM",
        recipient: deps.chatId || "UNCONFIGURED",
        status: "FAILED",
        latencyMs: Date.now() - deliveryStartedAt,
        detail: `channel=false; subscribers=${subsSent}/${eligibleSubs.length}`,
      },
    }).catch(() => undefined);
    await deps.recordOperationalMetric({
      metric: "telegram_delivery_failure",
      category: "alert",
      severity: "ERROR",
      count: 1,
      runId: signal.runId,
      symbol: signal.asset,
      value: Date.now() - deliveryStartedAt,
      unit: "ms",
      detail: `channel=false; subscribers=${subsSent}/${eligibleSubs.length}`,
    });
    deps.logEvent({
      component: "alert-worker",
      runId: signal.runId,
      asset: signal.asset,
      severity: "ERROR",
      message: "Telegram alert failed",
      signalId: signal.id,
    });
    await deps.recordAuditEvent({
      actor: "SYSTEM",
      action: "alert_failed",
      entityType: "Alert",
      entityId: queuedAlert.id,
      after: { signalId: signal.id, status: "FAILED" },
      correlationId: signal.runId,
    });
  }

  async function requeueAlerts(runId?: string): Promise<number> {
    const alerts = await deps.prisma.alert.findMany({
      where: {
        status: { in: ["FAILED", "SKIPPED"] },
        ...(runId ? { signal: { runId } } : {}),
      },
      include: { signal: true },
      take: 20,
    });

    for (const alert of alerts) {
      await sendSignal(alert.signal);
    }

    return alerts.length;
  }

  async function setAlertSendingPaused(paused: boolean) {
    const settings = await getSettings();
    const updated = await deps.prisma.telegramSettings.update({
      where: { id: settings.id },
      data: { enabled: !paused },
    });
    return updated;
  }

  return {
    sendSignal,
    requeueAlerts,
    setAlertSendingPaused,
  };
}

const telegramService = createTelegramService({
  prisma,
  logEvent,
  recordAuditEvent,
  recordOperationalMetric,
  sendSignalAlert,
  postToTelegram,
  botToken: BOT_TOKEN,
  chatId: CHAT_ID,
});

export const sendSignal = telegramService.sendSignal;
export const requeueAlerts = telegramService.requeueAlerts;
export const setAlertSendingPaused = telegramService.setAlertSendingPaused;

