import { NextRequest, NextResponse } from "next/server";

import { triggerAllAssetCycles } from "@/src/application/cycle/triggerAllAssetCycles";
import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CycleTriggerRouteDependencies = {
  apexSecret: string | undefined;
  requireOperator: typeof requireOperatorSession;
  fetchImpl?: typeof fetch;
  triggerCycle?: ((request: Request) => Promise<Response>) | null;
  triggerAllAssets?: typeof triggerAllAssetCycles;
};

export function createCycleTriggerRouteHandler(deps: CycleTriggerRouteDependencies) {
  return async function POST(request: NextRequest) {
    const auth = await deps.requireOperator();
    if (!auth.ok) {
      return auth.response;
    }

    if (typeof deps.triggerCycle === "function") {
      const apexSecret = deps.apexSecret?.trim();
      if (!apexSecret) {
        return NextResponse.json(
          {
            error: "APEX_SECRET not configured",
          },
          { status: 500 },
        );
      }

      const forwardedHeaders = new Headers(request.headers);
      forwardedHeaders.set("x-apex-secret", apexSecret);
      forwardedHeaders.delete("authorization");

      const forwardedRequest = new Request(new URL("/api/cycle", request.url), {
        method: "POST",
        headers: forwardedHeaders,
      });

      return deps.triggerCycle(forwardedRequest);
    }

    try {
      if (deps.fetchImpl) {
        const apexSecret = deps.apexSecret?.trim();
        if (!apexSecret) {
          return NextResponse.json(
            {
              error: "APEX_SECRET not configured",
            },
            { status: 500 },
          );
        }

        const response = await deps.fetchImpl(new URL("/api/cycle", request.url), {
          method: "POST",
          cache: "no-store",
          headers: {
            authorization: `Bearer ${apexSecret}`,
          },
        });

        const body = await response.text();
        return new NextResponse(body, {
          status: response.status,
          headers: {
            "content-type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
          },
        });
      }

      const result = await (deps.triggerAllAssets ?? triggerAllAssetCycles)({
        source: "cycle_trigger",
        includeMemecoins: true,
      });
      return NextResponse.json(result, { status: result.okCount === 0 ? 500 : 200 });
    } catch (error) {
      console.error("[cycle-trigger] Failed to trigger cycle:", error);
      return NextResponse.json(
        {
          error: "Cycle trigger failed",
        },
        { status: 500 },
      );
    }
  };
}

export const POST = createCycleTriggerRouteHandler({
  apexSecret: process.env.APEX_SECRET,
  requireOperator: requireOperatorSession,
  triggerAllAssets: triggerAllAssetCycles,
});
