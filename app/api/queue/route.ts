import { NextRequest, NextResponse } from "next/server";
import { enqueueSignalCycle, getSignalCycleQueue, QUEUE_UNAVAILABLE_REASON, queueAvailable } from "@/lib/queue";
import { recordAuditEvent } from "@/lib/audit";
import { requireAdmin } from "@/lib/admin/requireAdmin";

export const dynamic = "force-dynamic";
import { requeueAlerts, setAlertSendingPaused } from "@/lib/telegramService";
import { prisma } from "@/lib/prisma";
import { getDeadLetterOverview, markDeadLetterReplayed } from "@/lib/queue/deadLetter";
import { reconcileStaleRuns } from "@/lib/runLifecycle";

type QueueRouteDependencies = {
  prisma: typeof prisma;
  getSignalCycleQueue: typeof getSignalCycleQueue;
  enqueueSignalCycle: typeof enqueueSignalCycle;
  getDeadLetterOverview: typeof getDeadLetterOverview;
  markDeadLetterReplayed: typeof markDeadLetterReplayed;
  recordAuditEvent: typeof recordAuditEvent;
  requeueAlerts: typeof requeueAlerts;
  setAlertSendingPaused: typeof setAlertSendingPaused;
  reconcileStaleRuns: typeof reconcileStaleRuns;
  requireAdmin: typeof requireAdmin;
  queueAvailable: boolean;
  queueUnavailableReason: string;
};

export function createQueueRouteHandlers(deps: QueueRouteDependencies) {
  return {
    GET: async () => {
      type TelegramSettingsRecord = Awaited<ReturnType<typeof deps.prisma.telegramSettings.findFirst>>;

      await deps.reconcileStaleRuns();
      const settings = await deps.prisma.telegramSettings.findFirst().catch(() => null as TelegramSettingsRecord);
      if (!deps.queueAvailable) {
        return NextResponse.json({
          status: "DEGRADED",
          reason: deps.queueUnavailableReason,
          paused: true,
          degraded: true,
          alertSendingPaused: settings ? !settings.enabled : false,
          jobs: [],
        });
      }

      try {
        const queue = deps.getSignalCycleQueue();
        const jobs = await queue.getJobs(["failed", "waiting", "active", "delayed"], 0, 20, true);
        const paused = await queue.isPaused().catch(() => false);
        const deadLetters = await deps.getDeadLetterOverview(10);
        const waitingJobs = jobs.filter(job => !job.failedReason && !job.processedOn);
        const lagMs = waitingJobs.length > 0
          ? Math.max(
              ...waitingJobs.map(job => Math.max(0, Date.now() - (job.timestamp ?? Date.now())))
            )
          : null;

        return NextResponse.json({
          paused,
          degraded: false,
          alertSendingPaused: settings ? !settings.enabled : false,
          lagMs,
          deadLetters,
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
      } catch (error) {
        return NextResponse.json({
          paused: true,
          degraded: true,
          alertSendingPaused: settings ? !settings.enabled : false,
          jobs: [],
          reason: `Queue unavailable: ${String(error)}`,
        });
      }
    },

    POST: async (req: NextRequest) => {
      const auth = await deps.requireAdmin();
      if (!auth.ok) return auth.response;

      const body = await req.json().catch(() => null) as { action?: string; jobId?: string; runId?: string } | null;

      if (!body?.action) {
        return NextResponse.json({ error: "Missing action" }, { status: 400 });
      }

      if (body.action === "retry_job" && body.jobId) {
        if (!deps.queueAvailable) {
          return NextResponse.json({
            status: "DEGRADED",
            reason: deps.queueUnavailableReason,
          }, { status: 503 });
        }
        const job = await deps.getSignalCycleQueue().getJob(body.jobId);
        if (!job) {
          return NextResponse.json({ error: "Job not found" }, { status: 404 });
        }
        await job.retry();
        await deps.markDeadLetterReplayed(String(body.jobId), "RETRIED");
        await deps.recordAuditEvent({
          actor: "OPERATOR",
          action: "manual_retry_job",
          entityType: "QueueJob",
          entityId: String(body.jobId),
          correlationId: body.runId ?? null,
        });
        return NextResponse.json({ success: true, action: "retry_job", jobId: body.jobId });
      }

      if (body.action === "replay_dead_letter" && body.jobId) {
        const deadLetter = await deps.prisma.deadLetterJob.findUnique({
          where: { jobId: body.jobId },
        });
        if (!deadLetter) {
          return NextResponse.json({ error: "Dead-letter job not found" }, { status: 404 });
        }
        if (!deps.queueAvailable) {
          return NextResponse.json({
            status: "DEGRADED",
            reason: deps.queueUnavailableReason,
          }, { status: 503 });
        }
        const { job, runId } = await deps.enqueueSignalCycle(undefined, {
          actor: "OPERATOR",
          correlationId: deadLetter.correlationId ?? deadLetter.runId ?? null,
          retryOfRunId: deadLetter.runId ?? null,
        });
        await deps.markDeadLetterReplayed(String(body.jobId), "REQUEUED");
        await deps.recordAuditEvent({
          actor: "OPERATOR",
          action: "manual_replay_dead_letter",
          entityType: "DeadLetterJob",
          entityId: body.jobId,
          after: {
            newRunId: runId,
            jobId: job.id,
          },
          correlationId: runId,
        });
        return NextResponse.json({ success: true, action: "replay_dead_letter", jobId: job.id, runId });
      }

      if (body.action === "enqueue_cycle") {
        if (!deps.queueAvailable) {
          return NextResponse.json({
            status: "DEGRADED",
            reason: deps.queueUnavailableReason,
          }, { status: 503 });
        }
        const { job, runId } = await deps.enqueueSignalCycle(undefined, {
          actor: "OPERATOR",
          correlationId: null,
        });
        await deps.recordAuditEvent({
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
        if (!deps.queueAvailable) {
          return NextResponse.json({
            status: "DEGRADED",
            reason: deps.queueUnavailableReason,
          }, { status: 503 });
        }
        const { job, runId } = await deps.enqueueSignalCycle(undefined, {
          actor: "OPERATOR",
          correlationId: body.runId,
          retryOfRunId: body.runId,
        });
        await deps.recordAuditEvent({
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
        const count = await deps.requeueAlerts(body.runId);
        await deps.recordAuditEvent({
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
        await deps.setAlertSendingPaused(true);
        await deps.recordAuditEvent({
          actor: "OPERATOR",
          action: "manual_pause_alerts",
          entityType: "TelegramSettings",
          entityId: "default",
        });
        return NextResponse.json({ success: true, action: "pause_alerts" });
      }

      if (body.action === "resume_alerts") {
        await deps.setAlertSendingPaused(false);
        await deps.recordAuditEvent({
          actor: "OPERATOR",
          action: "manual_resume_alerts",
          entityType: "TelegramSettings",
          entityId: "default",
        });
        return NextResponse.json({ success: true, action: "resume_alerts" });
      }

      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
    },
  };
}

const queueRouteHandlers = createQueueRouteHandlers({
  prisma,
  getSignalCycleQueue,
  enqueueSignalCycle,
  getDeadLetterOverview,
  markDeadLetterReplayed,
  recordAuditEvent,
  requeueAlerts,
  setAlertSendingPaused,
  reconcileStaleRuns,
  requireAdmin,
  queueAvailable,
  queueUnavailableReason: QUEUE_UNAVAILABLE_REASON,
});

export const GET = queueRouteHandlers.GET;
export const POST = queueRouteHandlers.POST;
