import { NextResponse } from "next/server";

import { triggerCommoditiesCycle } from "@/src/assets/commodities/engine/commoditiesRuntime";
import { triggerIndicesCycle } from "@/src/assets/indices/engine/indicesRuntime";
import { triggerMemeCycle } from "@/src/assets/memecoins/engine/memeRuntime";
import { triggerStocksCycle } from "@/src/assets/stocks/engine/stocksRuntime";
import { getApexRuntime } from "@/src/application/cycle/buildRuntime";
import { queueFocusedRuntimeCycle, type FocusedRuntimeCycleHost } from "@/src/application/cycle/runCycle";
import { triggerAllAssetCycles } from "@/src/application/cycle/triggerAllAssetCycles";
import { triggerCryptoCycle } from "@/src/crypto/engine/cryptoRuntime";
import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type AllAssetsCycleTriggerRouteDependencies = {
  requireOperator: typeof requireOperatorSession;
  getRuntime?: () => FocusedRuntimeCycleHost;
  queueForexCycle?: typeof queueFocusedRuntimeCycle;
  triggerCrypto?: typeof triggerCryptoCycle;
  triggerStocks?: typeof triggerStocksCycle;
  triggerCommodities?: typeof triggerCommoditiesCycle;
  triggerIndices?: typeof triggerIndicesCycle;
  triggerMeme?: typeof triggerMemeCycle;
  triggerAllAssets?: typeof triggerAllAssetCycles;
};

export function createAllAssetsCycleTriggerRouteHandler(deps: AllAssetsCycleTriggerRouteDependencies) {
  return async function POST(_request?: Request) {
    const auth = await deps.requireOperator();
    if (!auth.ok) {
      return auth.response;
    }

    const result = await (deps.triggerAllAssets ?? triggerAllAssetCycles)({
      source: "system_controls_all_assets",
      getRuntime: deps.getRuntime ?? getApexRuntime,
      queueForexCycle: deps.queueForexCycle ?? queueFocusedRuntimeCycle,
      triggerCrypto: deps.triggerCrypto ?? triggerCryptoCycle,
      triggerStocks: deps.triggerStocks ?? triggerStocksCycle,
      triggerCommodities: deps.triggerCommodities ?? triggerCommoditiesCycle,
      triggerIndices: deps.triggerIndices ?? triggerIndicesCycle,
      triggerMeme: deps.triggerMeme ?? triggerMemeCycle,
      includeMemecoins: true,
    });

    return NextResponse.json(
      result,
      { status: result.okCount === 0 ? 500 : 200 },
    );
  };
}

export const POST = createAllAssetsCycleTriggerRouteHandler({
  requireOperator: requireOperatorSession,
});
