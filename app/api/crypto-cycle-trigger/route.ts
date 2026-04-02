import { NextResponse } from "next/server";

import { triggerCryptoCycle } from "@/src/crypto/engine/cryptoRuntime";
import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CryptoCycleTriggerRouteDependencies = {
  requireOperator: typeof requireOperatorSession;
  triggerCycle?: typeof triggerCryptoCycle;
};

export function createCryptoCycleTriggerRouteHandler(deps: CryptoCycleTriggerRouteDependencies) {
  return async function POST() {
    const auth = await deps.requireOperator();
    if (!auth.ok) {
      return auth.response;
    }

    try {
      const result = await (deps.triggerCycle ?? triggerCryptoCycle)();
      return NextResponse.json({
        queued: false,
        triggered: true,
        status: "completed",
        ...result,
      });
    } catch (error) {
      console.error("[api/crypto-cycle-trigger] Failed to trigger crypto cycle:", error);
      return NextResponse.json(
        {
          error: "Crypto cycle trigger failed",
        },
        { status: 500 },
      );
    }
  };
}

export const POST = createCryptoCycleTriggerRouteHandler({
  requireOperator: requireOperatorSession,
});
