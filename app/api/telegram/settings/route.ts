import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

async function getOrCreateSettings() {
  const existing = await prisma.telegramSettings.findFirst();
  if (existing) return existing;
  return prisma.telegramSettings.create({ data: {} });
}

export async function GET() {
  const settings = await getOrCreateSettings();
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const settings = await getOrCreateSettings();

  const updated = await prisma.telegramSettings.update({
    where: { id: settings.id },
    data: {
      enabled:           body.enabled           !== undefined ? Boolean(body.enabled)           : undefined,
      minRank:           body.minRank            !== undefined ? String(body.minRank)            : undefined,
      allowedAssets:     body.allowedAssets      !== undefined ? String(body.allowedAssets)      : undefined,
      weekendCryptoOnly: body.weekendCryptoOnly  !== undefined ? Boolean(body.weekendCryptoOnly) : undefined,
    },
  });

  return NextResponse.json(updated);
}
