import { NextResponse } from "next/server";

import { triggerCryptoCycle } from "@/src/crypto/engine/cryptoRuntime";
import { getCryptoSignalsPayload } from "@/src/crypto/engine/cryptoRuntime";
import { selectTradableAssets } from "@/src/crypto/engine/CryptoEngine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CRYPTO_BOOTSTRAP_TIMEOUT_MS = 25_000;

async function maybeBootstrapCryptoRuntime(): Promise<void> {
  const payload = getCryptoSignalsPayload();
  if (payload.lastCycleAt != null || payload.cycleRunning) {
    return;
  }

  console.log("[api/crypto-signals] Bootstrapping empty crypto runtime.");
  await Promise.race([
    triggerCryptoCycle().catch(error => {
      console.error("[api/crypto-signals] Crypto bootstrap failed:", error);
    }),
    new Promise(resolve => setTimeout(resolve, CRYPTO_BOOTSTRAP_TIMEOUT_MS)),
  ]);
}

export async function GET() {
  try {
    let payload = getCryptoSignalsPayload();
    if (payload.lastCycleAt == null && !payload.cycleRunning) {
      await maybeBootstrapCryptoRuntime();
      payload = getCryptoSignalsPayload();
    }

    if (payload.selectedAssets.length > 0) {
      return NextResponse.json(payload);
    }

    const selection = await selectTradableAssets();
    return NextResponse.json({
      ...payload,
      selectionGeneratedAt: selection.generatedAt,
      selectionProvider: selection.provider,
      selectedAssets: selection.assets,
    });
  } catch (error) {
    console.error("[api/crypto-signals] Failed to read crypto payload:", error);
    return NextResponse.json({
      generatedAt: Date.now(),
      wsConnected: false,
      cycleRunning: false,
      lastCycleAt: null,
      selectionGeneratedAt: null,
      selectionProvider: null,
      selectedAssets: [],
      cards: [],
      executable: [],
      monitored: [],
      rejected: [],
      liveMarketBoard: [],
    });
  }
}
