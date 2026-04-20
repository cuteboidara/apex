import { NextResponse } from "next/server";
import { listScalpAssetStates } from "@/src/scalp/api/scalpSignals";
import { SCALP_ASSETS, scalpAssetConfig } from "@/src/scalp/data/fetchers/scalpAssetConfig";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const states = await listScalpAssetStates();
    const byAsset = new Map(states.map(row => [row.assetId, row]));

    const merged = SCALP_ASSETS.map((assetId) => {
      const state = byAsset.get(assetId);
      const config = scalpAssetConfig[assetId];
      const hasState = Boolean(state);

      return {
        assetId,
        symbol: config.symbol,
        category: config.category,
        preferredSessions: config.preferredSessions,
        lastScanned: state?.lastScanned ?? null,
        lastPrice: state?.lastPrice ?? null,
        hasActiveSignal: state?.hasActiveSignal ?? false,
        trend1h: state?.trend1h ?? null,
        trend4h: state?.trend4h ?? null,
        currentSession: state?.currentSession ?? null,
        atrPct: state?.atrPct ?? null,
        dataStatus: !hasState ? "never" : ((state?.lastPrice ?? 0) > 0 ? "ready" : "no_data"),
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
