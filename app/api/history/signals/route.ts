import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rank = searchParams.get("rank");
  const asset = searchParams.get("asset");
  const setupFamily = searchParams.get("setupFamily");
  const regimeTag = searchParams.get("regimeTag");
  const outcome = searchParams.get("outcome");
  const providerHealth = searchParams.get("providerHealth");
  const limit = Math.max(1, Math.min(200, Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50));

  const signals = await prisma.signal.findMany({
    where: {
      ...(rank ? { rank } : {}),
      ...(asset ? { asset } : {}),
      ...(setupFamily || regimeTag || outcome || providerHealth
        ? {
            tradePlans: {
              some: {
                ...(setupFamily ? { setupFamily } : {}),
                ...(regimeTag ? { regimeTag } : {}),
                ...(outcome ? { outcome } : {}),
                ...(providerHealth ? { providerHealthStateAtSignal: providerHealth } : {}),
              },
            },
          }
        : {}),
    },
    include: {
      tradePlans: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ signals });
}
