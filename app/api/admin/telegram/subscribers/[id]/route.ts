import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/telegram/bot";

interface RouteParams { params: Promise<{ id: string }> }

// PATCH — update subscriber (suspend/activate, tier, alertsEnabled)
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;

  const allowed: (keyof typeof body)[] = ["status", "tier", "alertsEnabled", "alertAssets", "alertRanks"];
  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) data[key] = body[key];
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });
  }

  const updated = await prisma.telegramSubscriber.update({ where: { id }, data });
  return NextResponse.json(updated);
}

// DELETE — remove subscriber
export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  await prisma.telegramSubscriber.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

// POST — send a direct message to subscriber
export async function POST(req: NextRequest, { params }: RouteParams) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { message?: string };

  if (!body.message?.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const sub = await prisma.telegramSubscriber.findUnique({ where: { id } });
  if (!sub) return NextResponse.json({ error: "Subscriber not found" }, { status: 404 });

  const sent = await sendMessage(sub.chatId, body.message);
  return NextResponse.json({ ok: sent });
}
