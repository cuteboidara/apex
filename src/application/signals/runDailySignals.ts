import { getSignalsPayload } from "@/src/api/signals";
import {
  getCurrentTradingSession,
  type TradingSession,
} from "@/src/config/marketScope";
import {
  buildDailySignalBaseWindowKey,
  getDailySignalDateKey,
  getDailySignalsConfig,
} from "@/src/infrastructure/config/dailySignals";
import {
  DailySignalRunRepository,
  type DailySignalRunRecord,
} from "@/src/infrastructure/persistence/dailySignalRunRepository";
import { captureShadowTradePlans } from "@/src/application/outcomes/shadowTracker";

import { publishDailySignals, type PublishDailySignalsResult } from "./publishDailySignals";

type RunDailySignalsInput = {
  force?: boolean;
  dryRun?: boolean;
  now?: Date;
  session?: TradingSession;
  triggerSource: "manual_secret" | "operator";
  triggeredBy: string;
};

type RunDailySignalsDependencies = {
  getConfig?: typeof getDailySignalsConfig;
  runRepository?: DailySignalRunRepository;
  getSignals?: typeof getSignalsPayload;
  publish?: typeof publishDailySignals;
};

export type RunDailySignalsResult = {
  run: DailySignalRunRecord;
  created: boolean;
  zeroSignalDay: boolean;
  deliveries: PublishDailySignalsResult["deliveries"];
  deliveredCount: number;
  failedCount: number;
};

const GRADE_RANK: Record<string, number> = {
  "S+": 6,
  S: 5,
  A: 4,
  B: 3,
  C: 2,
  D: 1,
  F: 0,
};

function gradeMeetsMinimum(grade: string, minimumGrade: string): boolean {
  return (GRADE_RANK[grade] ?? -1) >= (GRADE_RANK[minimumGrade] ?? -1);
}

function gradeEligibleForTelegramAlert(grade: string): boolean {
  return grade === "S" || grade === "S+" || grade === "A" || grade === "B";
}

function hasCanonicalSignalPersistence(payload: Awaited<ReturnType<typeof getSignalsPayload>>): boolean {
  const signalRows = Array.isArray((payload as { signals?: unknown[] }).signals)
    ? ((payload as { signals?: Array<{ signal_id?: string | null }> }).signals ?? [])
    : [];
  return signalRows.length > 0 && signalRows.every(signal => typeof signal.signal_id === "string" && signal.signal_id.length > 0);
}

export async function runDailySignals(
  input: RunDailySignalsInput,
  deps: RunDailySignalsDependencies = {},
): Promise<RunDailySignalsResult> {
  const config = await (deps.getConfig ?? getDailySignalsConfig)();
  const runRepository = deps.runRepository ?? new DailySignalRunRepository();
  const now = input.now ?? new Date();
  const session = input.session ?? getCurrentTradingSession(now.getTime());
  const scheduledTime = config.sessionTimes[session];
  const baseWindowKey = buildDailySignalBaseWindowKey(now, config.timezone, session);
  const existing = await runRepository.findLatestByBaseWindowKey(baseWindowKey);

  if (existing && !input.force) {
    return {
      run: existing,
      created: false,
      zeroSignalDay: existing.zeroSignalDay,
      deliveries: [],
      deliveredCount: existing.deliveredCount,
      failedCount: existing.failedCount,
    };
  }

  if (!config.enabled && !input.force) {
    const skipped = await runRepository.create({
      windowKey: `${baseWindowKey}:disabled`,
      baseWindowKey,
      runDate: getDailySignalDateKey(now, config.timezone),
      timezone: config.timezone,
      scheduledTime,
      triggeredBy: input.triggeredBy,
      triggerSource: input.triggerSource,
      status: "skipped",
      forced: false,
      dryRun: Boolean(input.dryRun),
      zeroSignalDay: false,
      generatedCount: 0,
      publishedCount: 0,
      deliveredCount: 0,
      failedCount: 0,
      signalPayload: null,
      errorMessage: "daily_signals_disabled",
      completedAt: now,
    });

    return {
      run: skipped.record,
      created: skipped.created,
      zeroSignalDay: skipped.record.zeroSignalDay,
      deliveries: [],
      deliveredCount: skipped.record.deliveredCount,
      failedCount: skipped.record.failedCount,
    };
  }

  const windowKey = input.force ? `${baseWindowKey}:force:${Date.now()}` : baseWindowKey;
  const running = await runRepository.create({
    windowKey,
    baseWindowKey,
    runDate: getDailySignalDateKey(now, config.timezone),
    timezone: config.timezone,
    scheduledTime,
    triggeredBy: input.triggeredBy,
    triggerSource: input.triggerSource,
    status: "running",
    forced: Boolean(input.force),
    dryRun: Boolean(input.dryRun),
    zeroSignalDay: false,
    generatedCount: 0,
    publishedCount: 0,
    deliveredCount: 0,
    failedCount: 0,
    signalPayload: null,
    errorMessage: null,
  });

  if (!running.created) {
    return {
      run: running.record,
      created: false,
      zeroSignalDay: running.record.zeroSignalDay,
      deliveries: [],
      deliveredCount: running.record.deliveredCount,
      failedCount: running.record.failedCount,
    };
  }

  try {
    const payload = await (deps.getSignals ?? getSignalsPayload)();
    if (!hasCanonicalSignalPersistence(payload)) {
      const signalViews = Array.isArray((payload as { signals?: unknown[] }).signals)
        ? ((payload as {
          signals?: Array<{ view?: unknown }>;
          cycle_id?: string;
          generatedAt: number;
        }).signals ?? [])
          .map(signal => signal.view)
          .filter((view): view is Record<string, unknown> => Boolean(view) && typeof view === "object")
        : [];

      if (signalViews.length > 0) {
        await captureShadowTradePlans({
          source: "daily-signals",
          assetClass: "fx",
          cycleId: (payload as { cycle_id?: string }).cycle_id ?? `daily-signals-${Date.now()}`,
          generatedAt: payload.generatedAt,
          cards: signalViews as never[],
        }).catch(error => {
          console.error("[daily-signals] Shadow trade capture failed:", error);
        });
      }
    }
    const publishableCards = payload.cards.filter(card =>
      card.status === "active"
      && gradeMeetsMinimum(card.grade, config.minimumGrade)
      && gradeEligibleForTelegramAlert(card.grade),
    );
    const zeroSignalDay = publishableCards.length === 0;

    if (zeroSignalDay) {
      console.info("[daily-signals] Zero-signal day recorded", {
        baseWindowKey,
        runId: running.record.id,
      });
    }

    const staged = await runRepository.update(running.record.id, {
      generatedCount: payload.cards.length,
      zeroSignalDay,
      signalPayload: {
        generatedAt: payload.generatedAt,
        minimumGrade: config.minimumGrade,
        allCardsCount: payload.cards.length,
        publishableCardsCount: publishableCards.length,
        cards: publishableCards,
        marketCommentary: payload.marketCommentary ?? null,
      },
    });

    const publishResult = await (deps.publish ?? publishDailySignals)(staged.id, {
      runRepository,
    });
    const finalStatus = publishResult.failedCount > 0
      ? (publishResult.deliveredCount > 0 ? "partial_failed" : "failed")
      : "completed";

    const completed = await runRepository.update(staged.id, {
      publishedCount: publishResult.deliveries.length,
      deliveredCount: publishResult.deliveredCount,
      failedCount: publishResult.failedCount,
      status: finalStatus,
      completedAt: new Date(),
    });

    return {
      run: completed,
      created: true,
      zeroSignalDay,
      deliveries: publishResult.deliveries,
      deliveredCount: publishResult.deliveredCount,
      failedCount: publishResult.failedCount,
    };
  } catch (error) {
    const failed = await runRepository.update(running.record.id, {
      status: "failed",
      errorMessage: String(error),
      completedAt: new Date(),
    });
    throw Object.assign(new Error(String(error)), {
      run: failed,
    });
  }
}
