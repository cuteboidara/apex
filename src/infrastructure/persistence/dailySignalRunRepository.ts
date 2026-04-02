import { Prisma, type DailySignalRun } from "@prisma/client";

import { parseDailySignalBaseWindowKey } from "@/src/infrastructure/config/dailySignals";
import { prisma } from "@/src/infrastructure/db/prisma";
import { createId } from "@/src/lib/ids";
import type { TraderSignalsPayload } from "@/src/lib/traderContracts";

export type DailySignalRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial_failed"
  | "failed"
  | "skipped";

export type DailySignalRunRecord = {
  id: string;
  windowKey: string;
  baseWindowKey: string;
  runDate: string;
  timezone: string;
  scheduledTime: string;
  triggeredBy: string;
  triggerSource: "manual_secret" | "operator";
  status: DailySignalRunStatus;
  forced: boolean;
  dryRun: boolean;
  zeroSignalDay: boolean;
  generatedCount: number;
  publishedCount: number;
  deliveredCount: number;
  failedCount: number;
  signalPayload: {
    generatedAt: number;
    minimumGrade: string;
    allCardsCount: number;
    publishableCardsCount: number;
    cards: TraderSignalsPayload["cards"];
    marketCommentary: TraderSignalsPayload["marketCommentary"] | null;
  } | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type CreateDailySignalRunInput = Omit<
  DailySignalRunRecord,
  "id" | "createdAt" | "updatedAt" | "completedAt"
> & {
  completedAt?: Date | null;
};

export type UpdateDailySignalRunInput = Partial<Omit<DailySignalRunRecord, "id" | "createdAt">>;
export type CreateDailySignalRunResult = {
  record: DailySignalRunRecord;
  created: boolean;
};

const globalForDailySignalRuns = globalThis as typeof globalThis & {
  __apexDailySignalRuns?: Map<string, DailySignalRunRecord>;
};

function allowsMemoryFallback(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.APEX_ALLOW_DAILY_SIGNAL_MEMORY_FALLBACK?.trim().toLowerCase() === "true";
}

function getMemoryStore() {
  globalForDailySignalRuns.__apexDailySignalRuns ??= new Map<string, DailySignalRunRecord>();
  return globalForDailySignalRuns.__apexDailySignalRuns;
}

function cloneRecord<T>(value: T): T {
  return structuredClone(value);
}

function parseJsonObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function buildScheduledFor(runDate: string, scheduledTime: string): Date {
  return new Date(`${runDate}T${scheduledTime}:00.000Z`);
}

function formatScheduledTime(source: Date, fallback = "00:00"): string {
  if (Number.isNaN(source.getTime())) {
    return fallback;
  }
  return `${String(source.getUTCHours()).padStart(2, "0")}:${String(source.getUTCMinutes()).padStart(2, "0")}`;
}

function mapDbRecord(record: DailySignalRun): DailySignalRunRecord {
  const metadata = parseJsonObject(record.metadata);
  const scheduledTime = typeof metadata.scheduledTime === "string"
    ? metadata.scheduledTime
    : formatScheduledTime(record.scheduledFor);
  const baseWindowKey = typeof metadata.baseWindowKey === "string"
    ? metadata.baseWindowKey
    : `${record.runDate}:${record.timezone}`;
  const triggerSource = record.mode === "operator" ? "operator" : "manual_secret";

  return {
    id: record.id,
    windowKey: record.windowKey,
    baseWindowKey,
    runDate: record.runDate,
    timezone: record.timezone,
    scheduledTime,
    triggeredBy: record.triggeredBy,
    triggerSource,
    status: record.status as DailySignalRunStatus,
    forced: record.forced,
    dryRun: record.dryRun,
    zeroSignalDay: record.zeroSignalDay,
    generatedCount: record.generatedCount,
    publishedCount: record.publishedCount,
    deliveredCount: record.deliveredCount,
    failedCount: record.failedCount,
    signalPayload: (record.signalSnapshot as DailySignalRunRecord["signalPayload"] | null) ?? null,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt,
  };
}

function toCreateInput(input: CreateDailySignalRunInput): Prisma.DailySignalRunCreateInput {
  const parsedWindow = parseDailySignalBaseWindowKey(input.baseWindowKey);
  return {
    id: createId("dsrun"),
    windowKey: input.windowKey,
    runDate: input.runDate,
    timezone: input.timezone,
    scheduledFor: buildScheduledFor(input.runDate, input.scheduledTime),
    startedAt: input.status === "running" ? new Date() : null,
    completedAt: input.completedAt ?? null,
    triggeredBy: input.triggeredBy,
    mode: input.triggerSource,
    status: input.status,
    forced: input.forced,
    dryRun: input.dryRun,
    zeroSignalDay: input.zeroSignalDay,
    generatedCount: input.generatedCount,
    publishedCount: input.publishedCount,
    deliveredCount: input.deliveredCount,
    failedCount: input.failedCount,
    signalSnapshot: (input.signalPayload ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
    publicationPolicy: {
      minimumGrade: input.signalPayload?.minimumGrade ?? null,
      scheduledTime: input.scheduledTime,
    } as Prisma.InputJsonValue,
    errorMessage: input.errorMessage,
    metadata: {
      scheduledTime: input.scheduledTime,
      baseWindowKey: input.baseWindowKey,
      triggerSource: input.triggerSource,
      session: parsedWindow.session,
    } as Prisma.InputJsonValue,
  };
}

function toUpdateInput(current: DailySignalRunRecord, patch: UpdateDailySignalRunInput): Prisma.DailySignalRunUpdateInput {
  const merged: DailySignalRunRecord = {
    ...current,
    ...patch,
  };
  const parsedWindow = parseDailySignalBaseWindowKey(merged.baseWindowKey);

  return {
    windowKey: merged.windowKey,
    runDate: merged.runDate,
    timezone: merged.timezone,
    scheduledFor: buildScheduledFor(merged.runDate, merged.scheduledTime),
    completedAt: merged.completedAt,
    triggeredBy: merged.triggeredBy,
    mode: merged.triggerSource,
    status: merged.status,
    forced: merged.forced,
    dryRun: merged.dryRun,
    zeroSignalDay: merged.zeroSignalDay,
    generatedCount: merged.generatedCount,
    publishedCount: merged.publishedCount,
    deliveredCount: merged.deliveredCount,
    failedCount: merged.failedCount,
    signalSnapshot: (merged.signalPayload ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
    publicationPolicy: {
      minimumGrade: merged.signalPayload?.minimumGrade ?? null,
      scheduledTime: merged.scheduledTime,
    } as Prisma.InputJsonValue,
    errorMessage: merged.errorMessage,
    metadata: {
      scheduledTime: merged.scheduledTime,
      baseWindowKey: merged.baseWindowKey,
      triggerSource: merged.triggerSource,
      session: parsedWindow.session,
    } as Prisma.InputJsonValue,
  };
}

async function withStorageFallback<T>(
  operation: string,
  dbOperation: () => Promise<T>,
  memoryOperation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await dbOperation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("[dailySignalRunRepository] prisma failure", {
        operation,
        code: error.code,
        message: error.message,
      });

      if (error.code === "P2002") {
        throw new Error(`Daily signal run already exists for operation ${operation}`);
      }

      if (error.code === "P2025") {
        throw new Error(`Daily signal run record not found during ${operation}`);
      }
    }

    console.error(`[dailySignalRunRepository] ${operation} failed`, error);
    if (allowsMemoryFallback()) {
      return await memoryOperation();
    }
    throw new Error(`Daily signal run persistence failed during ${operation}`);
  }
}

export class DailySignalRunRepository {
  async findByWindowKey(windowKey: string): Promise<DailySignalRunRecord | null> {
    return withStorageFallback(
      "findByWindowKey",
      async () => {
        const record = await prisma.dailySignalRun.findUnique({ where: { windowKey } });
        return record ? mapDbRecord(record) : null;
      },
      () => {
        const record = [...getMemoryStore().values()].find(item => item.windowKey === windowKey) ?? null;
        return record ? cloneRecord(record) : null;
      },
    );
  }

  async findById(id: string): Promise<DailySignalRunRecord | null> {
    return withStorageFallback(
      "findById",
      async () => {
        const record = await prisma.dailySignalRun.findUnique({ where: { id } });
        return record ? mapDbRecord(record) : null;
      },
      () => {
        const record = getMemoryStore().get(id);
        return record ? cloneRecord(record) : null;
      },
    );
  }

  async findLatestByBaseWindowKey(baseWindowKey: string): Promise<DailySignalRunRecord | null> {
    return withStorageFallback(
      "findLatestByBaseWindowKey",
      async () => {
        const { runDate } = parseDailySignalBaseWindowKey(baseWindowKey);
        const record = await prisma.dailySignalRun.findFirst({
          where: {
            runDate,
            windowKey: {
              startsWith: baseWindowKey,
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        });
        return record ? mapDbRecord(record) : null;
      },
      () => {
        const record = [...getMemoryStore().values()]
          .filter(item => item.baseWindowKey === baseWindowKey)
          .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
        return record ? cloneRecord(record) : null;
      },
    );
  }

  async create(input: CreateDailySignalRunInput): Promise<CreateDailySignalRunResult> {
    try {
      const created = await prisma.dailySignalRun.create({
        data: toCreateInput(input),
      });
      return {
        record: mapDbRecord(created),
        created: true,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.dailySignalRun.findUnique({
          where: { windowKey: input.windowKey },
        });
        if (existing) {
          console.info("[dailySignalRunRepository] resolved create collision", {
            windowKey: input.windowKey,
            existingRunId: existing.id,
          });
          return {
            record: mapDbRecord(existing),
            created: false,
          };
        }
      }

      console.error("[dailySignalRunRepository] create failed", error);
      if (allowsMemoryFallback()) {
        const now = new Date();
        const record: DailySignalRunRecord = {
          id: createId("dsrun"),
          createdAt: now,
          updatedAt: now,
          completedAt: input.completedAt ?? null,
          ...input,
        };
        getMemoryStore().set(record.id, cloneRecord(record));
        return {
          record: cloneRecord(record),
          created: true,
        };
      }

      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === "P2002") {
          throw new Error(`Daily signal run already exists for windowKey ${input.windowKey}`);
        }
      }

      throw new Error("Daily signal run persistence failed during create");
    }
  }

  async update(id: string, patch: UpdateDailySignalRunInput): Promise<DailySignalRunRecord> {
    return withStorageFallback(
      "update",
      async () => prisma.$transaction(async tx => {
        const current = await tx.dailySignalRun.findUnique({ where: { id } });
        if (!current) {
          throw new Error(`Daily signal run ${id} not found`);
        }
        const updated = await tx.dailySignalRun.update({
          where: { id },
          data: toUpdateInput(mapDbRecord(current), patch),
        });
        return mapDbRecord(updated);
      }),
      () => {
        const current = getMemoryStore().get(id);
        if (!current) {
          throw new Error(`Daily signal run ${id} not found`);
        }
        const updated: DailySignalRunRecord = {
          ...current,
          ...patch,
          updatedAt: new Date(),
        };
        getMemoryStore().set(id, cloneRecord(updated));
        return cloneRecord(updated);
      },
    );
  }

  async listRecent(limit = 20): Promise<DailySignalRunRecord[]> {
    return withStorageFallback(
      "listRecent",
      async () => {
        const rows = await prisma.dailySignalRun.findMany({
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        return rows.map(mapDbRecord);
      },
      () => [...getMemoryStore().values()]
        .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
        .slice(0, limit)
        .map(cloneRecord),
    );
  }
}
