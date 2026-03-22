import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { SUPPORTED_ASSETS as ASSETS } from "@/lib/assets";

export async function GET() {
  type SignalRecord = Awaited<ReturnType<typeof prisma.signal.findMany>>[number];

  function hasUsablePrice(signal: SignalRecord | null | undefined) {
    const raw = (signal?.rawData ?? {}) as { price?: { current?: number | null } };
    return Number(raw.price?.current ?? 0) > 0 || (signal?.total ?? 0) > 0;
  }

  // Fetch the most recent usable signal for each asset in parallel
  const results = await Promise.all(
    ASSETS.map(a =>
      prisma.signal.findMany({
        where:   { asset: a.symbol, run: { status: "COMPLETED" } },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    )
  );

  // Return as a map: { BTCUSDT: signal, EURUSD: signal, ... }
  const map: Record<string, unknown> = {};
  ASSETS.forEach((a, i: number) => {
    const usable = results[i].find((signal: SignalRecord) => hasUsablePrice(signal)) ?? results[i][0] ?? null;
    if (usable) map[a.symbol] = usable;
  });

  return NextResponse.json(map);
}
