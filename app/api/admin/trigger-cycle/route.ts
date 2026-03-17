import { NextResponse } from "next/server";

import { recordAuditEvent } from "@/lib/audit";
import { logEvent } from "@/lib/logging";
import { prisma } from "@/lib/prisma";
import { ENGINE_VERSION, FEATURE_VERSION, PROMPT_VERSION } from "@/lib/runConfig";
import { runCycle } from "@/lib/scheduler";

export async function POST() {
  const run = await prisma.signalRun.create({
    data: {
      queuedAt: new Date(),
      engineVersion: ENGINE_VERSION,
      featureVersion: FEATURE_VERSION,
      promptVersion: PROMPT_VERSION,
      status: "QUEUED",
    },
  });

  try {
    await recordAuditEvent({
      actor: "OPERATOR",
      action: "manual_trigger",
      entityType: "SignalRun",
      entityId: run.id,
      after: { status: "QUEUED" },
      correlationId: run.id,
    });

    const result = await runCycle(run.id);
    return NextResponse.json({
      success: true,
      runId: run.id,
      signalCount: result.signals.length,
      status: "COMPLETED",
    });
  } catch (error) {
    logEvent({
      runId: run.id,
      component: "control-plane",
      severity: "ERROR",
      message: "Manual trigger cycle failed",
      reason: String(error),
    });

    return NextResponse.json(
      {
        success: false,
        runId: run.id,
        error: String(error),
      },
      { status: 500 }
    );
  }
}
