import { NextRequest, NextResponse } from "next/server";
import { enqueueSignalCycle, signalCycleQueue } from "@/lib/queue";
import { recordAuditEvent } from "@/lib/audit";
import { requeueAlerts, setAlertSendingPaused } from "@/lib/telegramService";
import { prisma } from "@/lib/prisma";
import { reconcileStaleRuns } from "@/lib/runLifecycle";

export async function GET() {
  type TelegramSettingsRecord = Awaited<ReturnType<typeof prisma.telegramSettings.findFirst>>;

  await reconcileStaleRuns();
  const jobs = await signalCycleQueue.getJobs(["failed", "waiting", "active", "delayed"], 0, 20, true);
  const paused = await signalCycleQueue.isPaused().catch(() => false);
  const settings = await prisma.telegramSettings.findFirst().catch(() => null as TelegramSettingsRecord);

  return NextResponse.json({
    paused,
    alertSendingPaused: settings ? !settings.enabled : false,
    jobs: jobs.map(job => ({
      id: job.id,
      name: job.name,
      state: job.finishedOn ? "completed" : undefined,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
      delay: job.delay,
      queueName: job.queueName,
      status: job.failedReason ? "failed" : job.processedOn ? "active" : job.delay ? "delayed" : "waiting",
      runId: typeof job.data?.runId === "string" ? job.data.runId : null,
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { action?: string; jobId?: string; runId?: string } | null;

  if (!body?.action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  if (body.action === "retry_job" && body.jobId) {
    const job = await signalCycleQueue.getJob(body.jobId);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    await job.retry();
    await recordAuditEvent({
      actor: "OPERATOR",
      action: "manual_retry_job",
      entityType: "QueueJob",
      entityId: String(body.jobId),
      correlationId: body.runId ?? null,
    });
    return NextResponse.json({ success: true, action: "retry_job", jobId: body.jobId });
  }

  if (body.action === "enqueue_cycle") {
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
    return NextResponse.json({ success: true, action: "enqueue_cycle", jobId: job.id, runId });
  }

  if (body.action === "retry_run" && body.runId) {
    const { job, runId } = await enqueueSignalCycle(undefined, {
      actor: "OPERATOR",
      correlationId: body.runId,
      retryOfRunId: body.runId,
    });
    await recordAuditEvent({
      actor: "OPERATOR",
      action: "manual_retry_run",
      entityType: "SignalRun",
      entityId: body.runId,
      after: { newRunId: runId, jobId: job.id },
      correlationId: runId,
    });
    return NextResponse.json({ success: true, action: "retry_run", previousRunId: body.runId, runId, jobId: job.id });
  }

  if (body.action === "requeue_alerts") {
    const count = await requeueAlerts(body.runId);
    await recordAuditEvent({
      actor: "OPERATOR",
      action: "manual_requeue_alerts",
      entityType: body.runId ? "SignalRun" : "AlertBatch",
      entityId: body.runId ?? "global",
      after: { count },
      correlationId: body.runId ?? null,
    });
    return NextResponse.json({ success: true, action: "requeue_alerts", count });
  }

  if (body.action === "pause_alerts") {
    await setAlertSendingPaused(true);
    await recordAuditEvent({
      actor: "OPERATOR",
      action: "manual_pause_alerts",
      entityType: "TelegramSettings",
      entityId: "default",
    });
    return NextResponse.json({ success: true, action: "pause_alerts" });
  }

  if (body.action === "resume_alerts") {
    await setAlertSendingPaused(false);
    await recordAuditEvent({
      actor: "OPERATOR",
      action: "manual_resume_alerts",
      entityType: "TelegramSettings",
      entityId: "default",
    });
    return NextResponse.json({ success: true, action: "resume_alerts" });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
