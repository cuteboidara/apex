import { NextRequest, NextResponse } from "next/server";

import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";
import { replayPayload } from "@/src/presentation/api/ops";

export const dynamic = "force-dynamic";

type OpsReplayRouteDependencies = {
  requireOperator: typeof requireOperatorSession;
  replayPayload: typeof replayPayload;
};

export function createOpsReplayRouteHandler(deps: OpsReplayRouteDependencies) {
  return async function POST(request: NextRequest) {
    const auth = await deps.requireOperator();
    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json();
    return NextResponse.json(await deps.replayPayload({
      symbol: String(body.symbol),
      from_ts: Number(body.from_ts),
      to_ts: Number(body.to_ts),
    }));
  };
}

export const POST = createOpsReplayRouteHandler({
  requireOperator: requireOperatorSession,
  replayPayload,
});
