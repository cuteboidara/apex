import { NextResponse } from "next/server";
import { enqueueSignalCycle, QUEUE_UNAVAILABLE_REASON, queueAvailable } from "@/lib/queue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
import { logEvent } from "@/lib/logging";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { ENGINE_VERSION, FEATURE_VERSION, PROMPT_VERSION } from "@/lib/runConfig";
import { runCycle } from "@/lib/scheduler";

async function runCycleDirectly() {
  const run = await prisma.signalRun.create({
    data: {
      queuedAt: new Date(),
      engineVersion: ENGINE_VERSION,
      featureVersion: FEATURE_VERSION,
      promptVersion: PROMPT_VERSION,
      status: "QUEUED",
    },
  });

  await recordAuditEvent({
    actor: "OPERATOR",
    action: "manual_trigger",
    entityType: "SignalRun",
    entityId: run.id,
    after: {
      status: "QUEUED",
      executionMode: "direct",
    },
    correlationId: run.id,
  });

  const result = await runCycle(run.id);
  return { runId: run.id, signalCount: result.signals.length };
}

export async function POST() {
  if (!queueAvailable) {
    try {
      const result = await runCycleDirectly();
      return NextResponse.json({
        success: true,
        degraded: true,
        status: "DEGRADED",
        reason: QUEUE_UNAVAILABLE_REASON,
        mode: "direct",
        runId: result.runId,
        signalCount: result.signalCount,
        runStatus: "COMPLETED",
      });
    } catch (err) {
      logEvent({
        component: "control-plane",
        severity: "ERROR",
        message: "Manual cycle error",
        reason: String(err),
      });
      return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
    }
  }

  try {
    const { job, runId } = await enqueueSignalCycle(undefined, {
      actor: "OPERATOR",
      correlationId: null,
    });
    await recordAuditEvent({
      actor: "OPERATOR",
      action: "manual_enqueue",
      entityType: "SignalRun",
      entityId: runId,
      after: { jobId: job.id },
      correlationId: runId,
    });
    return NextResponse.json({
      success: true,
      mode: "queue",
      jobId: job.id,
      runId,
      queue: job.queueName,
      status: "QUEUED",
    });
  } catch (err) {
    logEvent({
      component: "control-plane",
      severity: "ERROR",
      message: "Manual cycle error",
      reason: String(err),
    });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
