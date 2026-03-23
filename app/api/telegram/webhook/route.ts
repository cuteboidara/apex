import { NextRequest, NextResponse } from "next/server";
import { handleUpdate } from "@/lib/telegram/bot";
import type { TelegramUpdate } from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Read secret inside handler — never at module level (avoids Railway build-time env errors)
  const webhookSecret = process.env.APEX_WEBHOOK_SECRET ?? "";

  // Validate secret token (set via Telegram setWebhook secret_token param)
  const incomingSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (webhookSecret && incomingSecret !== webhookSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Process in background — Telegram expects 200 OK within 5 s
  handleUpdate(update).catch(err => {
    console.error("[APEX:webhook] handleUpdate error:", String(err).slice(0, 200));
  });

  return NextResponse.json({ ok: true });
}

// Telegram pings webhooks with GET on initial verification
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: "APEX Telegram Webhook" });
}
