import { NextRequest, NextResponse } from "next/server";

import { getApexRuntime } from "@/src/application/cycle/buildRuntime";
import { queueFocusedRuntimeCycle } from "@/src/application/cycle/runCycle";
import { validateApexSecretRequest } from "@/src/infrastructure/security/apexSecret";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CycleRouteDependencies = {
  getRuntime: typeof getApexRuntime;
  queueCycle?: typeof queueFocusedRuntimeCycle;
  apexSecret: string | undefined;
};

export function createCycleRouteHandler(deps: CycleRouteDependencies) {
  return async function handleCycleRequest(request: NextRequest) {
    // APEX_SECRET is required on ALL environments — no dev bypass.
    // Set APEX_SECRET in your .env.local for local development.
    // Provide via Authorization: Bearer <secret> or x-apex-secret header.
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
      const runtime = deps.getRuntime();
      const queued = await (deps.queueCycle ?? queueFocusedRuntimeCycle)(runtime, "api");
      if (queued.queued) {
        return NextResponse.json({
          success: true,
          queued: true,
          trigger: "api",
          job_id: queued.jobId,
          mode: runtime.config.mode,
        });
      }

      const result = queued.result!;
      return NextResponse.json({
        success: true,
        queued: false,
        trigger: "api",
        mode: runtime.config.mode,
        cycle_id: result.cycle_id,
        timestamp: result.timestamp,
        symbols: result.symbols,
      });
    } catch (error) {
      console.error("[cycle-route] Failed to queue cycle:", error);
      return NextResponse.json(
        {
          error: "Runtime not initialized",
        },
        { status: 503 },
      );
    }
  };
}

export const POST = createCycleRouteHandler({
  getRuntime: getApexRuntime,
  queueCycle: queueFocusedRuntimeCycle,
  apexSecret: process.env.APEX_SECRET,
});

export const GET = POST;
