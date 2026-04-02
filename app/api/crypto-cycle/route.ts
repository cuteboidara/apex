import { NextRequest, NextResponse } from "next/server";

import { triggerCryptoCycle } from "@/src/crypto/engine/cryptoRuntime";
import { validateApexSecretRequest } from "@/src/infrastructure/security/apexSecret";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CryptoCycleRouteDependencies = {
  apexSecret: string | undefined;
  triggerCycle?: typeof triggerCryptoCycle;
};

export function createCryptoCycleRouteHandler(deps: CryptoCycleRouteDependencies) {
  return async function POST(request: NextRequest) {
    const auth = validateApexSecretRequest(request, deps.apexSecret);
    if (!auth.ok) {
      return NextResponse.json(
        {
          error: auth.error,
        },
        { status: auth.status },
      );
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
      console.error("[api/crypto-cycle] Failed to trigger crypto cycle:", error);
      return NextResponse.json(
        {
          error: "Crypto cycle failed",
        },
        { status: 500 },
      );
    }
  };
}

export const POST = createCryptoCycleRouteHandler({
  apexSecret: process.env.APEX_SECRET,
});
