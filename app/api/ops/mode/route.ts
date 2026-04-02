import { NextRequest, NextResponse } from "next/server";

import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";
import { setRecoveryModePayload } from "@/src/presentation/api/ops";
import type { RecoveryMode } from "@/src/interfaces/contracts";

export const dynamic = "force-dynamic";

type OpsModeRouteDependencies = {
  requireOperator: typeof requireOperatorSession;
  setRecoveryModePayload: typeof setRecoveryModePayload;
};

export function createOpsModeRouteHandler(deps: OpsModeRouteDependencies) {
  return async function POST(request: NextRequest) {
    const auth = await deps.requireOperator();
    if (!auth.ok) {
      return auth.response;
    }

    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await deps.setRecoveryModePayload((body.mode ?? "normal") as RecoveryMode));
  };
}

export const POST = createOpsModeRouteHandler({
  requireOperator: requireOperatorSession,
  setRecoveryModePayload,
});
