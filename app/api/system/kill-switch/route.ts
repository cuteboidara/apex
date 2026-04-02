import { NextRequest, NextResponse } from "next/server";

import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";
import { toggleKillSwitchPayload } from "@/src/presentation/api/system";

export const dynamic = "force-dynamic";

type KillSwitchRouteDependencies = {
  requireOperator: typeof requireOperatorSession;
  toggleKillSwitchPayload: typeof toggleKillSwitchPayload;
};

export function createKillSwitchRouteHandler(deps: KillSwitchRouteDependencies) {
  return async function POST(request: NextRequest) {
    const auth = await deps.requireOperator();
    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json().catch(() => ({}));
    const active = Boolean(body.active);
    return NextResponse.json(await deps.toggleKillSwitchPayload(active));
  };
}

export const POST = createKillSwitchRouteHandler({
  requireOperator: requireOperatorSession,
  toggleKillSwitchPayload,
});
