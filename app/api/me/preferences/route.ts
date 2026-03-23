import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function getUserId(session: unknown) {
  const user = (session as { user?: { id?: string } } | null)?.user;
  return user?.id ?? null;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = getUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const preference = await prisma.userPreference.findUnique({
    where: { userId },
  });

  return NextResponse.json({ preference });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = getUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as Partial<{
    timezone: string | null;
    quietHoursStart: number | null;
    quietHoursEnd: number | null;
    stylePreferences: string[];
    subscribedSymbols: string[];
    subscribedAssetClasses: string[];
    alertsEnabled: boolean;
    emailDigestEnabled: boolean;
    webhookAlertsEnabled: boolean;
  }> | null;

  const preference = await prisma.userPreference.upsert({
    where: { userId },
    create: {
      userId,
      timezone: body?.timezone ?? null,
      quietHoursStart: body?.quietHoursStart ?? null,
      quietHoursEnd: body?.quietHoursEnd ?? null,
      stylePreferences: body?.stylePreferences ?? [],
      subscribedSymbols: body?.subscribedSymbols ?? [],
      subscribedAssetClasses: body?.subscribedAssetClasses ?? [],
      alertsEnabled: body?.alertsEnabled ?? true,
      emailDigestEnabled: body?.emailDigestEnabled ?? false,
      webhookAlertsEnabled: body?.webhookAlertsEnabled ?? false,
    },
    update: {
      timezone: body?.timezone ?? null,
      quietHoursStart: body?.quietHoursStart ?? null,
      quietHoursEnd: body?.quietHoursEnd ?? null,
      stylePreferences: body?.stylePreferences ?? [],
      subscribedSymbols: body?.subscribedSymbols ?? [],
      subscribedAssetClasses: body?.subscribedAssetClasses ?? [],
      alertsEnabled: body?.alertsEnabled ?? true,
      emailDigestEnabled: body?.emailDigestEnabled ?? false,
      webhookAlertsEnabled: body?.webhookAlertsEnabled ?? false,
    },
  });

  return NextResponse.json({ preference });
}
