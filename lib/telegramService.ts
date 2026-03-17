import { prisma } from "@/lib/prisma";
import { logEvent } from "@/lib/logging";
import { recordAuditEvent } from "@/lib/audit";

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

async function getOrCreateSettings() {
  // Load settings (create default if missing)
  let settings = await prisma.telegramSettings.findFirst();
  if (!settings) {
    settings = await prisma.telegramSettings.create({ data: {} });
  }
  return settings;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function sendSignal(signal: SignalRecord): Promise<void> {
  const settings = await getOrCreateSettings();

  const queuedAlert = await prisma.alert.create({
    data: {
      signalId: signal.id,
      channel: "TELEGRAM",
      recipient: CHAT_ID || "UNCONFIGURED",
      status: "QUEUED",
      retryCount: 0,
    },
  });
  await recordAuditEvent({
    actor: "SYSTEM",
    action: "alert_queued",
    entityType: "Alert",
    entityId: queuedAlert.id,
    after: { signalId: signal.id, channel: "TELEGRAM" },
    correlationId: signal.runId,
  });

  if (!settings.enabled) {
    await prisma.alert.update({
      where: { id: queuedAlert.id },
      data: { status: "SKIPPED", failureReason: "Telegram alerts disabled" },
    });
    return;
  }

  // Rank filter
  if (!rankMeetsMinimum(signal.rank, settings.minRank)) {
    await prisma.alert.update({
      where: { id: queuedAlert.id },
      data: { status: "SKIPPED", failureReason: `Rank ${signal.rank} below minimum ${settings.minRank}` },
    });
    return;
  }

  // Asset filter
  if (settings.allowedAssets !== "ALL") {
    const allowed = settings.allowedAssets.split(",").map(s => s.trim());
    if (!allowed.includes(signal.asset)) {
      await prisma.alert.update({
        where: { id: queuedAlert.id },
        data: { status: "SKIPPED", failureReason: `${signal.asset} not in allowed asset list` },
      });
      return;
    }
  }

  // Weekend rule
  if (settings.weekendCryptoOnly) {
    const day = new Date().getDay(); // 0 = Sunday, 6 = Saturday
    if (day === 0 || day === 6) {
      if (!WEEKEND_CRYPTO.has(signal.asset)) {
        await prisma.alert.update({
          where: { id: queuedAlert.id },
          data: { status: "SKIPPED", failureReason: "Weekend mode only allows crypto assets" },
        });
        return;
      }
    }
  }

  if (!BOT_TOKEN || !CHAT_ID) {
    await prisma.alert.update({
      where: { id: queuedAlert.id },
      data: {
        status: "FAILED",
        attemptedAt: new Date(),
        failureReason: "Telegram credentials missing",
      },
    });
    await recordAuditEvent({
      actor: "SYSTEM",
      action: "alert_failed",
      entityType: "Alert",
      entityId: queuedAlert.id,
      after: { reason: "Telegram credentials missing" },
      correlationId: signal.runId,
    });
    return;
  }

  const message = formatSignalMessage(signal);
  const attemptedAt = new Date();
  const sent = await postToTelegram(message);

  if (sent) {
    await prisma.alert.update({
      where: { id: queuedAlert.id },
      data: {
        status: "DELIVERED",
        attemptedAt,
        deliveredAt: new Date(),
      },
    });
    await prisma.signal.update({
      where: { id: signal.id },
      data:  { sentTelegram: true },
    });
    logEvent({
      component: "alert-worker",
      runId: signal.runId,
      asset: signal.asset,
      message: "Telegram alert delivered",
      signalId: signal.id,
    });
    await recordAuditEvent({
      actor: "SYSTEM",
      action: "alert_sent",
      entityType: "Alert",
      entityId: queuedAlert.id,
      after: { signalId: signal.id, status: "DELIVERED" },
      correlationId: signal.runId,
    });
    return;
  }

  await prisma.alert.update({
    where: { id: queuedAlert.id },
    data: {
      status: "FAILED",
      attemptedAt,
      failureReason: "Telegram API request failed",
      retryCount: { increment: 1 },
    },
  });
  logEvent({
    component: "alert-worker",
    runId: signal.runId,
    asset: signal.asset,
    severity: "ERROR",
    message: "Telegram alert failed",
    signalId: signal.id,
  });
  await recordAuditEvent({
    actor: "SYSTEM",
    action: "alert_failed",
    entityType: "Alert",
    entityId: queuedAlert.id,
    after: { signalId: signal.id, status: "FAILED" },
    correlationId: signal.runId,
  });
}

export async function requeueAlerts(runId?: string): Promise<number> {
  const alerts = await prisma.alert.findMany({
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

export async function setAlertSendingPaused(paused: boolean) {
  const settings = await getOrCreateSettings();
  const updated = await prisma.telegramSettings.update({
    where: { id: settings.id },
    data: { enabled: !paused },
  });
  return updated;
}
