import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ASSETS } from "@/lib/apexEngine";

export async function GET() {
  // Fetch the most recent signal for each asset in parallel
  const results = await Promise.all(
    ASSETS.map(a =>
      prisma.signal.findFirst({
        where:   { asset: a.symbol, run: { status: "COMPLETED" } },
        orderBy: { createdAt: "desc" },
      })
    )
  );

  // Return as a map: { BTCUSDT: signal, EURUSD: signal, ... }
  const map: Record<string, unknown> = {};
  ASSETS.forEach((a, i: number) => {
    if (results[i]) map[a.symbol] = results[i];
  });

  return NextResponse.json(map);
}
