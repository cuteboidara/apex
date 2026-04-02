// Handles Telegram bot commands and subscriber interactions only.
// It does not own active signal alert delivery; use src/lib/telegram.ts for that path.
import { prisma } from "@/lib/prisma";
import { getSignalsPayload } from "@/src/api/signals";
import { getSystemStatusPayload } from "@/src/api/system";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TelegramMessage {
  message_id: number;
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  chat: { id: number; type: string };
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: { id: number; first_name: string; username?: string };
    message?: TelegramMessage;
    data?: string;
  };
}

type SignalRow = {
  id: string;
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

type RuntimeSignalSummary = {
  symbol: string;
  direction: string;
  grade: string;
  session: string;
  shortReasoning: string;
};

// ── Telegram API helpers ───────────────────────────────────────────────────────

export async function sendMessage(
  chatId: number | string,
  text: string,
  options: Record<string, unknown> = {},
): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", ...options }),
    });
    if (!res.ok) {
      const responseText = await res.text();
      console.error("[APEX TELEGRAM BOT] sendMessage failed", {
        status: res.status,
        chatId: String(chatId),
        responseBody: responseText,
      });
      return false;
    }
    return res.ok;
  } catch (error) {
    console.error("[APEX TELEGRAM BOT] sendMessage threw", {
      chatId: String(chatId),
      error: String(error),
    });
    return false;
  }
}

// ── Format helpers ─────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 4): string {
  if (n == null || !isFinite(n)) return "—";
  return n.toFixed(decimals);
}

export function formatSignalMessage(signal: SignalRow): string {
  const dir = signal.direction === "LONG" ? "📈 LONG" : "📉 SHORT";
  const rankEmoji = signal.rank === "S" ? "🌟" : signal.rank === "A" ? "⭐" : "✦";
  const ts = new Date(signal.createdAt).toUTCString();

  return [
    `${rankEmoji} <b>APEX SIGNAL — ${signal.rank}</b>`,
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

export async function sendSignalAlert(chatId: number | string, signal: SignalRow): Promise<boolean> {
  const text = formatSignalMessage(signal);
  return sendMessage(chatId, text);
}

// ── Subscriber upsert ─────────────────────────────────────────────────────────

async function upsertSubscriber(msg: TelegramMessage) {
  const chatId = String(msg.chat.id);
  await prisma.telegramSubscriber.upsert({
    where: { chatId },
    create: {
      chatId,
      username: msg.from?.username,
      firstName: msg.from?.first_name,
      lastName: msg.from?.last_name,
      languageCode: msg.from?.language_code,
      status: "ACTIVE",
    },
    update: {
      username: msg.from?.username,
      firstName: msg.from?.first_name,
      lastName: msg.from?.last_name,
      lastActiveAt: new Date(),
      messageCount: { increment: 1 },
      status: "ACTIVE",
    },
  });
}

// ── Command handlers ───────────────────────────────────────────────────────────

async function handleStart(msg: TelegramMessage) {
  await upsertSubscriber(msg);
  const name = msg.from?.first_name ?? "trader";
  await sendMessage(
    msg.chat.id,
    `👋 <b>Welcome to APEX Signals, ${name}!</b>\n\n` +
    `You're now subscribed to institutional-grade SMC/ICT trading signals.\n\n` +
    `<b>Commands:</b>\n` +
    `/signals — Last 5 signals\n` +
    `/performance — Win stats\n` +
    `/status — System status\n` +
    `/alerts — Configure alerts\n` +
    `/help — Show this menu\n\n` +
    `Signals are sent automatically for ranks S, A, and B. Enjoy! 🚀`,
  );
}

async function handleSignals(msg: TelegramMessage) {
  await upsertSubscriber(msg);
  const payload = await getSignalsPayload();
  const activeSignals = payload.activeSignals.slice(0, 5).map(signal => ({
    symbol: signal.symbol,
    direction: signal.direction.toUpperCase(),
    grade: signal.grade,
    session: signal.session,
    shortReasoning: signal.shortReasoning,
  })) satisfies RuntimeSignalSummary[];

  if (activeSignals.length === 0) {
    await sendMessage(msg.chat.id, "📭 No active signals right now. Check back after the next analysis cycle.");
    return;
  }

  const lines = activeSignals.map(signal =>
    `• <b>${signal.symbol}</b> · ${signal.direction} · ${signal.grade} · ${signal.session}\n  ${signal.shortReasoning}`,
  );

  await sendMessage(
    msg.chat.id,
    [
      `📡 <b>Current Active Signals (${activeSignals.length})</b>`,
      "",
      ...lines,
    ].join("\n"),
  );
}

async function handlePerformance(msg: TelegramMessage) {
  await upsertSubscriber(msg);

  const plans = await prisma.tradePlan.findMany({
    where: { outcome: { not: null } },
    select: { outcome: true, publicationRank: true },
  });

  if (plans.length === 0) {
    await sendMessage(msg.chat.id, "📊 No completed trades yet.");
    return;
  }

  const wins = plans.filter(p => p.outcome === "WIN").length;
  const losses = plans.filter(p => p.outcome === "LOSS").length;
  const winRate = plans.length > 0 ? ((wins / plans.length) * 100).toFixed(1) : "0";

  const byRank: Record<string, { w: number; total: number }> = {};
  for (const p of plans) {
    const r = p.publicationRank ?? "?";
    if (!byRank[r]) byRank[r] = { w: 0, total: 0 };
    byRank[r].total++;
    if (p.outcome === "WIN") byRank[r].w++;
  }

  const rankLines = Object.entries(byRank)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([r, { w, total }]) => `  Rank ${r}: ${w}/${total} (${((w / total) * 100).toFixed(0)}%)`)
    .join("\n");

  await sendMessage(
    msg.chat.id,
    `📈 <b>APEX Performance</b>\n\n` +
    `Total trades: <b>${plans.length}</b>\n` +
    `Wins: <b>${wins}</b> | Losses: <b>${losses}</b>\n` +
    `Win rate: <b>${winRate}%</b>\n\n` +
    `<b>By rank:</b>\n${rankLines || "  No data"}`,
  );
}

async function handleStatus(msg: TelegramMessage) {
  await upsertSubscriber(msg);
  const [status, signals] = await Promise.all([
    getSystemStatusPayload(),
    getSignalsPayload(),
  ]);
  const subscribers = await prisma.telegramSubscriber.count({ where: { status: "ACTIVE" } });
  const lastRun = status.last_cycle_ts
    ? new Date(status.last_cycle_ts).toUTCString()
    : "No runs yet";
  const readiness = typeof status.readiness === "string"
    ? status.readiness
    : (status.readiness?.market_data_status ?? "unknown");

  await sendMessage(
    msg.chat.id,
    `⚙️ <b>APEX System Status</b>\n\n` +
    `🟢 Engine: <b>${"status" in status && status.status === "offline" ? "Offline" : "Online"}</b>\n` +
    `📡 Active signals: <b>${signals.activeSignals.length}</b>\n` +
    `📊 Pairs tracked: <b>${signals.liveMarketBoard.length}</b>\n` +
    `🧭 Readiness: <b>${readiness}</b>\n` +
    `👥 Active subscribers: <b>${subscribers}</b>\n` +
    `🔄 Last cycle: ${lastRun}`,
  );
}

async function handleAlerts(msg: TelegramMessage) {
  await upsertSubscriber(msg);
  const sub = await prisma.telegramSubscriber.findUnique({ where: { chatId: String(msg.chat.id) } });

  if (!sub) {
    await sendMessage(msg.chat.id, "❌ Subscriber not found. Use /start first.");
    return;
  }

  const alertAssets = sub.alertAssets.length > 0 ? sub.alertAssets.join(", ") : "ALL";
  const alertRanks = sub.alertRanks.join(", ");

  await sendMessage(
    msg.chat.id,
    `🔔 <b>Your Alert Settings</b>\n\n` +
    `Status: <b>${sub.alertsEnabled ? "✅ Enabled" : "❌ Disabled"}</b>\n` +
    `Assets: <b>${alertAssets}</b>\n` +
    `Min ranks: <b>${alertRanks}</b>\n` +
    `Tier: <b>${sub.tier}</b>\n\n` +
    `To change settings, contact an admin or visit the APEX dashboard.`,
  );
}

async function handleHelp(msg: TelegramMessage) {
  await upsertSubscriber(msg);
  await sendMessage(
    msg.chat.id,
    `🤖 <b>APEX Bot Help</b>\n\n` +
    `<b>Commands:</b>\n` +
    `/start — Subscribe & welcome\n` +
    `/signals — Last 5 signals\n` +
    `/performance — Win/loss stats\n` +
    `/status — System status\n` +
    `/alerts — Your alert preferences\n` +
    `/help — Show this message\n\n` +
    `<b>About APEX:</b>\n` +
    `Institutional-grade SMC/ICT signals covering Forex, Metals & Crypto. ` +
    `Signals run every 15 minutes automatically.\n\n` +
    `Ranks: 🌟 S (85-100) | ⭐ A (70-84) | ✦ B (55-69)`,
  );
}

// ── Main dispatcher ────────────────────────────────────────────────────────────

export async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;

  const text = msg.text.trim();
  const command = text.split(" ")[0].toLowerCase();

  // Strip bot username suffix (e.g. /start@apexbot)
  const baseCommand = command.split("@")[0];

  switch (baseCommand) {
    case "/start":       return handleStart(msg);
    case "/signals":     return handleSignals(msg);
    case "/performance": return handlePerformance(msg);
    case "/status":      return handleStatus(msg);
    case "/alerts":      return handleAlerts(msg);
    case "/help":        return handleHelp(msg);
    default:
      if (text.startsWith("/")) {
        await sendMessage(msg.chat.id, "Unknown command. Available: /status, /signals, /alerts, /help");
      }
  }
}
