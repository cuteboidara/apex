import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const alerts = await prisma.alert.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        signal: {
          select: {
            id: true,
            runId: true,
            asset: true,
            rank: true,
            direction: true,
            total: true,
            createdAt: true,
          },
        },
      },
    });

    return NextResponse.json(alerts);
  } catch {
    return NextResponse.json([]);
  }
}
