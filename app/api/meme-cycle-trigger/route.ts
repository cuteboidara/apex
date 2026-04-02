import { NextRequest, NextResponse } from "next/server";

import { getMemeScannerPayload } from "@/src/assets/memecoins/intelligence/memeScanner";
import { getMemeTrendRadarPayload } from "@/src/assets/memecoins/intelligence/memeTrends";
import { triggerMemeCycle } from "@/src/assets/memecoins/engine/memeRuntime";
import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";
import { extractApexSecretFromRequest, validateApexSecretRequest } from "@/src/infrastructure/security/apexSecret";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorizeRequest(request: NextRequest) {
  const providedSecret = extractApexSecretFromRequest(request);
  if (providedSecret) {
    const secretAuth = validateApexSecretRequest(request, process.env.APEX_SECRET);
    if (!secretAuth.ok) {
      return NextResponse.json(
        {
          error: secretAuth.error,
        },
        { status: secretAuth.status },
      );
    }
    return null;
  }

  const operatorAuth = await requireOperatorSession();
  if (!operatorAuth.ok) {
    return operatorAuth.response;
  }
  return null;
}

async function handleMemeCycleTrigger(request: NextRequest) {
  const authResponse = await authorizeRequest(request);
  if (authResponse) {
    return authResponse;
  }

  try {
    const [cycle, scanner, trends] = await Promise.all([
      triggerMemeCycle(),
      getMemeScannerPayload({ force: true }),
      getMemeTrendRadarPayload({ force: true }),
    ]);

    return NextResponse.json({
      success: true,
      queued: false,
      triggered: true,
      status: "completed",
      ...cycle,
      coinsScanned: scanner.coins.length,
      trendsFound: trends.trends.length,
      alertsSent: scanner.alertsSent,
    });
  } catch (error) {
    console.error("[api/meme-cycle-trigger] Failed to trigger meme cycle:", error);
    return NextResponse.json(
      {
        error: "Meme cycle trigger failed",
      },
      { status: 500 },
    );
  }
}

export const POST = handleMemeCycleTrigger;
export const GET = handleMemeCycleTrigger;
