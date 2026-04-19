import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { ADMIN_EMAIL } from "@/lib/admin/auth";
import { auditLog } from "@/lib/admin/auditLog";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  let botInfo: { username?: string; first_name?: string } | null = null;

  if (token) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const data = await res.json() as { ok: boolean; result: { username: string; first_name: string } };
      if (data.ok) botInfo = data.result;
    } catch { /* offline */ }
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date();
  monthStart.setDate(1);

  const [todayCount, weekCount, monthCount, recentAlerts] = await Promise.all([
    prisma.alert.count({ where: { channel: "TELEGRAM", deliveredAt: { gte: todayStart } } }),
    prisma.alert.count({ where: { channel: "TELEGRAM", deliveredAt: { gte: weekStart } } }),
    prisma.alert.count({ where: { channel: "TELEGRAM", deliveredAt: { gte: monthStart } } }),
    prisma.alert.findMany({
      where: { channel: "TELEGRAM" },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { signal: { select: { asset: true, rank: true, direction: true } } },
    }),
  ]);

  return NextResponse.json({ botInfo, stats: { today: todayCount, week: weekCount, month: monthCount }, recentAlerts });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { message } = await req.json() as { message?: string };
  if (!message?.trim()) return NextResponse.json({ error: "message required" }, { status: 400 });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return NextResponse.json({ error: "Telegram not configured" }, { status: 503 });
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message.trim(), parse_mode: "HTML" }),
  });
  const data = await res.json() as { ok: boolean; description?: string };

  if (!data.ok) {
    return NextResponse.json({ error: data.description ?? "Telegram error" }, { status: 500 });
  }

  await auditLog("telegram_broadcast", ADMIN_EMAIL, {
    messageLength: message.trim().length,
  });
  return NextResponse.json({ success: true });
}
