import { NextResponse } from "next/server";

import { listSniperAssetStates } from "@/src/sniper/api/sniperSignals";
import { SNIPER_ASSETS, sniperAssetConfig } from "@/src/sniper/data/fetchers/assetConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const states = await listSniperAssetStates();
    const byAsset = new Map(states.map(row => [row.assetId, row]));

    const merged = SNIPER_ASSETS.map((assetId) => {
      const state = byAsset.get(assetId);
      const config = sniperAssetConfig[assetId];
      const hasState = Boolean(state);
      const recent = Array.isArray(state?.recentSweeps) ? state.recentSweeps as Array<Record<string, unknown>> : [];
      const firstStatus = typeof recent[0]?.status === "string" ? String(recent[0]?.status) : null;
      const dataStatus = !hasState ? "never" : (firstStatus === "error" ? "error" : ((state?.lastPrice ?? 0) > 0 ? "ready" : "no_data"));

      return {
        assetId,
        symbol: config.symbol,
        category: config.category,
        preferredSessions: config.preferredSessions,
        lastScanned: state?.lastScanned ?? null,
        lastPrice: state?.lastPrice ?? null,
        hasActiveSignal: state?.hasActiveSignal ?? false,
        recentSweeps: state?.recentSweeps ?? [],
        dataStatus,
        updatedAt: state?.updatedAt ?? null,
      };
    });

    return NextResponse.json(merged);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
