import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { runDailySignals } from "@/src/application/signals/runDailySignals";
import {
  getCurrentTradingSession,
  TRADING_SESSIONS,
} from "@/src/config/marketScope";
import { requireOperatorSession } from "@/src/infrastructure/auth/requireOperator";
import {
  getDailySignalsConfig,
  shouldRunNow,
  type DailySignalSession,
} from "@/src/infrastructure/config/dailySignals";
import { extractApexSecretFromRequest } from "@/src/infrastructure/security/apexSecret";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DailySignalsJobBody = {
  force?: boolean;
  dryRun?: boolean;
  session?: DailySignalSession | "all";
  adminSecret?: string;
};

type DailySignalsJobAuthorization =
  | { ok: true; triggerSource: "manual_secret" | "operator"; triggeredBy: string; authMode: "manual_secret" | "operator_session" }
  | { ok: false; response: NextResponse; authMode: "manual_secret" | "operator_session" | "none" };

type DailySignalsJobResponse = {
  success: boolean;
  executed: boolean;
  reason:
    | "scheduled_run_created"
    | "already_ran_for_window"
    | "daily_signals_disabled"
    | "unauthorized"
    | "invalid_request"
    | "run_failed";
  authorization: {
    triggerSource: "manual_secret" | "operator" | null;
    triggeredBy: string | null;
    authMode: "manual_secret" | "operator_session" | "none";
  };
  request: {
    force: boolean;
    dryRun: boolean;
    session: DailySignalSession | "all" | null;
  };
  schedule: {
    enabled: boolean | null;
    time: string | null;
    timezone: string | null;
    shouldRunNow: boolean | null;
    sessionTimes: Record<DailySignalSession, string> | null;
    sessionsDue: DailySignalSession[];
  };
  run: null | {
    id: string;
    windowKey: string;
    baseWindowKey: string;
    session: DailySignalSession | null;
    status: string;
    dryRun: boolean;
    forced: boolean;
    zeroSignalDay: boolean;
    generatedCount: number;
    publishedCount: number;
    deliveredCount: number;
    failedCount: number;
  };
  error: null | {
    message: string;
  };
  created?: boolean;
  runId?: string;
  windowKey?: string;
  baseWindowKey?: string;
  status?: string;
  dryRun?: boolean;
  forced?: boolean;
  zeroSignalDay?: boolean;
  generatedCount?: number;
  publishedCount?: number;
  deliveredCount?: number;
  failedCount?: number;
  session?: DailySignalSession | null;
  sessions?: DailySignalSession[];
  runs?: Array<{
    id: string;
    windowKey: string;
    baseWindowKey: string;
    session: DailySignalSession | null;
    status: string;
    dryRun: boolean;
    forced: boolean;
    zeroSignalDay: boolean;
    generatedCount: number;
    publishedCount: number;
    deliveredCount: number;
    failedCount: number;
  }>;
  triggerSource?: "manual_secret" | "operator";
  triggeredBy?: string;
};

type DailySignalsJobRouteDependencies = {
  requireOperator?: typeof requireOperatorSession;
  runDailySignalsFn?: typeof runDailySignals;
  getConfig?: typeof getDailySignalsConfig;
  shouldRunNowFn?: typeof shouldRunNow;
  getConfiguredAdminSecret?: () => string | null;
};

function configuredAdminSecret(): string | null {
  return process.env.APEX_DAILY_SIGNALS_SECRET?.trim()
    || process.env.APEX_SECRET?.trim()
    || null;
}

function secretsMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function extractAdminSecretFromRequest(
  request: NextRequest,
  bodySecret?: string | null,
): string | null {
  const url = new URL(request.url);
  const querySecret = url.searchParams.get("adminSecret")?.trim() ?? "";
  if (querySecret) {
    return querySecret;
  }

  const headerSecret = request.headers.get("x-apex-admin-secret")?.trim() ?? "";
  if (headerSecret) {
    return headerSecret;
  }

  const normalizedBodySecret = bodySecret?.trim() ?? "";
  if (normalizedBodySecret) {
    return normalizedBodySecret;
  }

  return extractApexSecretFromRequest(request);
}

function isDailySignalSession(value: string | null | undefined): value is DailySignalSession {
  return Boolean(value && (TRADING_SESSIONS as readonly string[]).includes(value));
}

function extractRequestedSession(
  request: NextRequest,
  body: DailySignalsJobBody,
): DailySignalSession | "all" | null {
  const bodyValue = typeof body.session === "string" ? body.session.trim().toLowerCase() : "";
  const queryValue = new URL(request.url).searchParams.get("session")?.trim().toLowerCase() ?? "";
  const rawValue = bodyValue || queryValue;

  if (rawValue === "all") {
    return "all";
  }

  return isDailySignalSession(rawValue) ? rawValue : null;
}

function resolveDueSessions(
  currentTime: Date,
  config: Awaited<ReturnType<typeof getDailySignalsConfig>>,
  shouldRunNowFn: typeof shouldRunNow,
): DailySignalSession[] {
  return TRADING_SESSIONS.filter(session => shouldRunNowFn(currentTime, config, session));
}

function resolveTargetSessions(input: {
  now: Date;
  config: Awaited<ReturnType<typeof getDailySignalsConfig>>;
  requestedSession: DailySignalSession | "all" | null;
  triggerSource: "manual_secret" | "operator";
  force: boolean;
  dueSessions: DailySignalSession[];
}): DailySignalSession[] {
  const currentSession = getCurrentTradingSession(input.now.getTime());
  const bypassScheduleWindow = input.force || input.triggerSource === "operator" || input.triggerSource === "manual_secret";

  if (!input.config.enabled && !input.force) {
    if (input.requestedSession === "all") {
      return [currentSession];
    }

    return [input.requestedSession ?? currentSession];
  }

  if (input.requestedSession === "all") {
    if (bypassScheduleWindow) {
      return [...TRADING_SESSIONS];
    }

    return input.dueSessions;
  }

  if (input.requestedSession) {
    if (bypassScheduleWindow) {
      return [input.requestedSession];
    }

    return input.dueSessions.includes(input.requestedSession) ? [input.requestedSession] : [];
  }

  if (bypassScheduleWindow) {
    return [currentSession];
  }

  return input.dueSessions;
}

function buildResponse(input: DailySignalsJobResponse, init?: ResponseInit) {
  return NextResponse.json(input, init);
}

function getRequestContext(request: NextRequest) {
  return {
    method: request.method,
    path: new URL(request.url).pathname,
    forwardedFor: request.headers.get("x-forwarded-for"),
    userAgent: request.headers.get("user-agent"),
  };
}

function logInvocation(
  event: string,
  request: NextRequest,
  detail: Record<string, unknown>,
) {
  console.info("[daily-signals-job]", {
    event,
    at: new Date().toISOString(),
    ...getRequestContext(request),
    ...detail,
  });
}

async function resolveAuthorizationWithDependencies(
  request: NextRequest,
  deps: Pick<DailySignalsJobRouteDependencies, "requireOperator" | "getConfiguredAdminSecret">,
  bodySecret?: string | null,
): Promise<DailySignalsJobAuthorization> {
  const providedSecret = extractAdminSecretFromRequest(request, bodySecret);
  if (providedSecret) {
    const configuredSecret = (deps.getConfiguredAdminSecret ?? configuredAdminSecret)();
    if (!configuredSecret) {
      return {
        ok: false,
        authMode: "manual_secret",
        response: buildResponse(
          {
            success: false,
            executed: false,
            reason: "unauthorized",
            authorization: {
              triggerSource: null,
              triggeredBy: null,
              authMode: "manual_secret",
            },
            request: {
              force: false,
              dryRun: false,
              session: null,
            },
            schedule: {
              enabled: null,
              time: null,
              timezone: null,
              shouldRunNow: null,
              sessionTimes: null,
              sessionsDue: [],
            },
            run: null,
            error: {
              message: "Admin secret is not configured",
            },
          },
          { status: 500 },
        ),
      };
    }

    if (!secretsMatch(configuredSecret, providedSecret)) {
      return {
        ok: false,
        authMode: "manual_secret",
        response: buildResponse(
          {
            success: false,
            executed: false,
            reason: "unauthorized",
            authorization: {
              triggerSource: null,
              triggeredBy: null,
              authMode: "manual_secret",
            },
            request: {
              force: false,
              dryRun: false,
              session: null,
            },
            schedule: {
              enabled: null,
              time: null,
              timezone: null,
              shouldRunNow: null,
              sessionTimes: null,
              sessionsDue: [],
            },
            run: null,
            error: {
              message: "Unauthorized",
            },
          },
          { status: 401 },
        ),
      };
    }

    return {
      ok: true,
      triggerSource: "manual_secret",
      triggeredBy: "manual_secret",
      authMode: "manual_secret",
    };
  }

  const auth = await (deps.requireOperator ?? requireOperatorSession)();
  if (!auth.ok) {
    return {
      ok: false,
      authMode: "operator_session",
      response: buildResponse(
        {
          success: false,
          executed: false,
          reason: "unauthorized",
          authorization: {
            triggerSource: null,
            triggeredBy: null,
            authMode: "operator_session",
          },
          request: {
            force: false,
            dryRun: false,
            session: null,
          },
          schedule: {
            enabled: null,
            time: null,
            timezone: null,
            shouldRunNow: null,
            sessionTimes: null,
            sessionsDue: [],
          },
          run: null,
          error: {
            message: "Unauthorized",
          },
        },
        { status: 401 },
      ),
    };
  }

  const triggeredBy = auth.session?.user?.email ?? auth.session?.user?.id ?? "operator";
  return {
    ok: true,
    triggerSource: "operator",
    triggeredBy,
    authMode: "operator_session",
  };
}

export function createDailySignalsJobRouteHandler(
  deps: DailySignalsJobRouteDependencies = {},
) {
  return async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({} as DailySignalsJobBody));
    const force = Boolean(body.force);
    const dryRun = Boolean(body.dryRun);
    const adminSecret = typeof body.adminSecret === "string" ? body.adminSecret.trim() : "";
    const requestedSession = extractRequestedSession(request, body);

    logInvocation("received", request, {
      force,
      dryRun,
      requestedSession,
    });

    const authorization = await resolveAuthorizationWithDependencies(request, {
      requireOperator: deps.requireOperator ?? requireOperatorSession,
      getConfiguredAdminSecret: deps.getConfiguredAdminSecret ?? configuredAdminSecret,
    }, adminSecret);
    if (!authorization.ok) {
      logInvocation("rejected", request, {
        authMode: authorization.authMode,
        reason: "unauthorized",
      });
      return authorization.response;
    }

    const now = new Date();
    const config = await (deps.getConfig ?? getDailySignalsConfig)();
    const shouldRunNowFn = deps.shouldRunNowFn ?? shouldRunNow;
    const dueSessions = resolveDueSessions(now, config, shouldRunNowFn);
    const scheduleReady = requestedSession && requestedSession !== "all"
      ? dueSessions.includes(requestedSession)
      : dueSessions.length > 0;
    const targetSessions = resolveTargetSessions({
      now,
      config,
      requestedSession,
      triggerSource: authorization.triggerSource,
      force,
      dueSessions,
    });

    try {
      const runResults: Array<{
        session: DailySignalSession;
        result: Awaited<ReturnType<typeof runDailySignals>>;
      }> = [];

      for (const session of targetSessions) {
        const result = await (deps.runDailySignalsFn ?? runDailySignals)({
          force,
          dryRun,
          now,
          session,
          triggerSource: authorization.triggerSource,
          triggeredBy: authorization.triggeredBy,
        });
        runResults.push({ session, result });
      }

      if (runResults.length === 0) {
        return buildResponse(
          {
            success: false,
            executed: false,
            reason: "invalid_request",
            authorization: {
              triggerSource: authorization.triggerSource,
              triggeredBy: authorization.triggeredBy,
              authMode: authorization.authMode,
            },
            request: {
              force,
              dryRun,
              session: requestedSession,
            },
            schedule: {
              enabled: config.enabled,
              time: config.time,
              timezone: config.timezone,
              shouldRunNow: scheduleReady,
              sessionTimes: config.sessionTimes,
              sessionsDue: dueSessions,
            },
            run: null,
            error: {
              message: "No target sessions resolved for daily signals",
            },
          },
          { status: 400 },
        );
      }

      const createdAny = runResults.some(item => item.result.created);
      const skippedOnly = runResults.every(item => item.result.run.status === "skipped");
      const reason = !createdAny
        ? "already_ran_for_window"
        : skippedOnly
          ? "daily_signals_disabled"
          : "scheduled_run_created";
      const primary = runResults.find(item => item.result.created) ?? runResults[0];

      logInvocation("completed", request, {
        authMode: authorization.authMode,
        triggerSource: authorization.triggerSource,
        triggeredBy: authorization.triggeredBy,
        force,
        dryRun,
        requestedSession,
        targetSessions,
        created: createdAny,
        reason,
        runIds: runResults.map(item => item.result.run.id),
        windowKeys: runResults.map(item => item.result.run.windowKey),
        statuses: runResults.map(item => item.result.run.status),
        zeroSignalDays: runResults.map(item => item.result.zeroSignalDay),
        generatedCount: runResults.reduce((sum, item) => sum + item.result.run.generatedCount, 0),
        deliveredCount: runResults.reduce((sum, item) => sum + item.result.run.deliveredCount, 0),
        failedCount: runResults.reduce((sum, item) => sum + item.result.run.failedCount, 0),
        sessionTimes: config.sessionTimes,
        scheduleTimezone: config.timezone,
        shouldRunNow: scheduleReady,
        dueSessions,
      });

      return buildResponse({
        success: true,
        executed: createdAny,
        reason,
        authorization: {
          triggerSource: authorization.triggerSource,
          triggeredBy: authorization.triggeredBy,
          authMode: authorization.authMode,
        },
        request: {
          force,
          dryRun,
          session: requestedSession,
        },
        schedule: {
          enabled: config.enabled,
          time: config.time,
          timezone: config.timezone,
          shouldRunNow: scheduleReady,
          sessionTimes: config.sessionTimes,
          sessionsDue: dueSessions,
        },
        run: {
          id: primary.result.run.id,
          windowKey: primary.result.run.windowKey,
          baseWindowKey: primary.result.run.baseWindowKey,
          session: primary.session,
          status: primary.result.run.status,
          dryRun: primary.result.run.dryRun,
          forced: primary.result.run.forced,
          zeroSignalDay: primary.result.zeroSignalDay,
          generatedCount: primary.result.run.generatedCount,
          publishedCount: primary.result.run.publishedCount,
          deliveredCount: primary.result.run.deliveredCount,
          failedCount: primary.result.run.failedCount,
        },
        error: null,
        created: createdAny,
        runId: primary.result.run.id,
        windowKey: primary.result.run.windowKey,
        baseWindowKey: primary.result.run.baseWindowKey,
        status: primary.result.run.status,
        dryRun: primary.result.run.dryRun,
        forced: primary.result.run.forced,
        zeroSignalDay: primary.result.zeroSignalDay,
        generatedCount: primary.result.run.generatedCount,
        publishedCount: primary.result.run.publishedCount,
        deliveredCount: primary.result.run.deliveredCount,
        failedCount: primary.result.run.failedCount,
        session: primary.session,
        sessions: targetSessions,
        runs: runResults.map(item => ({
          id: item.result.run.id,
          windowKey: item.result.run.windowKey,
          baseWindowKey: item.result.run.baseWindowKey,
          session: item.session,
          status: item.result.run.status,
          dryRun: item.result.run.dryRun,
          forced: item.result.run.forced,
          zeroSignalDay: item.result.zeroSignalDay,
          generatedCount: item.result.run.generatedCount,
          publishedCount: item.result.run.publishedCount,
          deliveredCount: item.result.run.deliveredCount,
          failedCount: item.result.run.failedCount,
        })),
        triggerSource: authorization.triggerSource,
        triggeredBy: authorization.triggeredBy,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logInvocation("failed", request, {
        authMode: authorization.authMode,
        triggerSource: authorization.triggerSource,
        triggeredBy: authorization.triggeredBy,
        force,
        dryRun,
        requestedSession,
        error: message,
        sessionTimes: config.sessionTimes,
        scheduleTimezone: config.timezone,
        shouldRunNow: scheduleReady,
        dueSessions,
      });

      return buildResponse(
        {
          success: false,
          executed: false,
          reason: "run_failed",
          authorization: {
            triggerSource: authorization.triggerSource,
            triggeredBy: authorization.triggeredBy,
            authMode: authorization.authMode,
          },
          request: {
            force,
            dryRun,
            session: requestedSession,
          },
          schedule: {
            enabled: config.enabled,
            time: config.time,
            timezone: config.timezone,
            shouldRunNow: scheduleReady,
            sessionTimes: config.sessionTimes,
            sessionsDue: dueSessions,
          },
          run: null,
          error: {
            message,
          },
        },
        { status: 500 },
      );
    }
  };
}

export const POST = createDailySignalsJobRouteHandler();
