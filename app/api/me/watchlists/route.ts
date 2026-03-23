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

  const watchlists = await prisma.watchlist.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  const assets = await prisma.watchlistAsset.findMany({
    where: { watchlistId: { in: watchlists.map(watchlist => watchlist.id) } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    watchlists: watchlists.map(watchlist => ({
      ...watchlist,
      assets: assets.filter(asset => asset.watchlistId === watchlist.id),
    })),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = getUserId(session);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null) as
    | { action?: "create_watchlist" | "add_asset" | "remove_asset"; name?: string; watchlistId?: string; symbol?: string }
    | null;

  if (body?.action === "create_watchlist" && body.name) {
    const watchlist = await prisma.watchlist.create({
      data: {
        userId,
        name: body.name,
      },
    });
    return NextResponse.json({ watchlist });
  }

  if (body?.action === "add_asset" && body.watchlistId && body.symbol) {
    const asset = await prisma.watchlistAsset.upsert({
      where: {
        watchlistId_symbol: {
          watchlistId: body.watchlistId,
          symbol: body.symbol,
        },
      },
      create: {
        watchlistId: body.watchlistId,
        symbol: body.symbol,
      },
      update: {},
    });
    return NextResponse.json({ asset });
  }

  if (body?.action === "remove_asset" && body.watchlistId && body.symbol) {
    await prisma.watchlistAsset.delete({
      where: {
        watchlistId_symbol: {
          watchlistId: body.watchlistId,
          symbol: body.symbol,
        },
      },
    }).catch(() => undefined);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Unsupported watchlist action" }, { status: 400 });
}
