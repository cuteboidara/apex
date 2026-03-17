import { NextResponse } from "next/server";
import { enqueueSignalCycle, isQueueConfigured } from "@/lib/queue";
import { logEvent } from "@/lib/logging";
import { recordAuditEvent } from "@/lib/audit";

export async function POST() {
  if (!isQueueConfigured()) {
    return NextResponse.json(
      {
        success: false,
        degraded: true,
        error: "Queue unavailable: REDIS_URL is not configured.",
      },
      { status: 503 }
    );
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
