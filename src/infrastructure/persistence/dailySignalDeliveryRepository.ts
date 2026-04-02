import { Prisma, type DailySignalDelivery } from "@prisma/client";

import { prisma } from "@/src/infrastructure/db/prisma";
import { createId } from "@/src/lib/ids";

export type DailySignalDeliveryStatus =
  | "queued"
  | "delivering"
  | "delivered"
  | "failed"
  | "skipped";

export type DailySignalDeliveryRecord = {
  id: string;
  runId: string;
  channel: string;
  target: string;
  dedupeKey: string;
  payloadHash: string;
  status: DailySignalDeliveryStatus;
  attempts: number;
  explicitRetry: boolean;
  providerMessageId: string | null;
  errorMessage: string | null;
  payloadSnapshot: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
};

export type CreateDailySignalDeliveryInput = Omit<
  DailySignalDeliveryRecord,
  "id" | "createdAt" | "updatedAt" | "lastAttemptAt" | "deliveredAt"
> & {
  lastAttemptAt?: Date | null;
  deliveredAt?: Date | null;
};

export type UpdateDailySignalDeliveryInput = Partial<Omit<DailySignalDeliveryRecord, "id" | "createdAt">>;
export type CreateDailySignalDeliveryResult = {
  record: DailySignalDeliveryRecord;
  created: boolean;
};

const globalForDailySignalDeliveries = globalThis as typeof globalThis & {
  __apexDailySignalDeliveries?: Map<string, DailySignalDeliveryRecord>;
};

function allowsMemoryFallback(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.APEX_ALLOW_DAILY_SIGNAL_MEMORY_FALLBACK?.trim().toLowerCase() === "true";
}

function getMemoryStore() {
  globalForDailySignalDeliveries.__apexDailySignalDeliveries ??= new Map<string, DailySignalDeliveryRecord>();
  return globalForDailySignalDeliveries.__apexDailySignalDeliveries;
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

function mapDbRecord(record: DailySignalDelivery): DailySignalDeliveryRecord {
  const metadata = parseJsonObject(record.metadata);

  return {
    id: record.id,
    runId: record.dailySignalRunId,
    channel: record.channel,
    target: record.target,
    dedupeKey: record.dedupeKey,
    payloadHash: typeof metadata.payloadHash === "string" ? metadata.payloadHash : "",
    status: record.status as DailySignalDeliveryStatus,
    attempts: record.attempts,
    explicitRetry: Boolean(metadata.explicitRetry),
    providerMessageId: typeof metadata.providerMessageId === "string" ? metadata.providerMessageId : null,
    errorMessage: record.errorMessage,
    payloadSnapshot: (record.payloadSnapshot as Record<string, unknown> | null) ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastAttemptAt: record.lastAttemptAt,
    deliveredAt: record.deliveredAt,
  };
}

function toCreateInput(input: CreateDailySignalDeliveryInput): Prisma.DailySignalDeliveryCreateInput {
  return {
    id: createId("dsdel"),
    dailySignalRun: {
      connect: {
        id: input.runId,
      },
    },
    channel: input.channel,
    target: input.target,
    dedupeKey: input.dedupeKey,
    status: input.status,
    signalCount: Array.isArray(input.payloadSnapshot?.publishableSignals)
      ? input.payloadSnapshot.publishableSignals.length
      : 0,
    attempts: input.attempts,
    lastAttemptAt: input.lastAttemptAt ?? null,
    deliveredAt: input.deliveredAt ?? null,
    errorMessage: input.errorMessage,
    payloadSnapshot: (input.payloadSnapshot ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
    metadata: {
      payloadHash: input.payloadHash,
      explicitRetry: input.explicitRetry,
      providerMessageId: input.providerMessageId,
    } as Prisma.InputJsonValue,
  };
}

function toUpdateInput(
  current: DailySignalDeliveryRecord,
  patch: UpdateDailySignalDeliveryInput,
): Prisma.DailySignalDeliveryUpdateInput {
  const merged: DailySignalDeliveryRecord = {
    ...current,
    ...patch,
  };

  return {
    channel: merged.channel,
    target: merged.target,
    dedupeKey: merged.dedupeKey,
    status: merged.status,
    signalCount: Array.isArray(merged.payloadSnapshot?.publishableSignals)
      ? merged.payloadSnapshot.publishableSignals.length
      : 0,
    attempts: merged.attempts,
    lastAttemptAt: merged.lastAttemptAt,
    deliveredAt: merged.deliveredAt,
    errorMessage: merged.errorMessage,
    payloadSnapshot: (merged.payloadSnapshot ?? null) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput,
    metadata: {
      payloadHash: merged.payloadHash,
      explicitRetry: merged.explicitRetry,
      providerMessageId: merged.providerMessageId,
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
      console.error("[dailySignalDeliveryRepository] prisma failure", {
        operation,
        code: error.code,
        message: error.message,
      });

      if (error.code === "P2002") {
        throw new Error(`Daily signal delivery already exists for operation ${operation}`);
      }

      if (error.code === "P2025") {
        throw new Error(`Daily signal delivery record not found during ${operation}`);
      }
    }

    console.error(`[dailySignalDeliveryRepository] ${operation} failed`, error);
    if (allowsMemoryFallback()) {
      return await memoryOperation();
    }
    throw new Error(`Daily signal delivery persistence failed during ${operation}`);
  }
}

export class DailySignalDeliveryRepository {
  async findById(id: string): Promise<DailySignalDeliveryRecord | null> {
    return withStorageFallback(
      "findById",
      async () => {
        const record = await prisma.dailySignalDelivery.findUnique({ where: { id } });
        return record ? mapDbRecord(record) : null;
      },
      () => {
        const record = getMemoryStore().get(id);
        return record ? cloneRecord(record) : null;
      },
    );
  }

  async findByDedupeKey(dedupeKey: string): Promise<DailySignalDeliveryRecord | null> {
    return withStorageFallback(
      "findByDedupeKey",
      async () => {
        const record = await prisma.dailySignalDelivery.findUnique({ where: { dedupeKey } });
        return record ? mapDbRecord(record) : null;
      },
      () => {
        const record = [...getMemoryStore().values()].find(item => item.dedupeKey === dedupeKey) ?? null;
        return record ? cloneRecord(record) : null;
      },
    );
  }

  async create(input: CreateDailySignalDeliveryInput): Promise<CreateDailySignalDeliveryResult> {
    try {
      const created = await prisma.dailySignalDelivery.create({
        data: toCreateInput(input),
      });
      return {
        record: mapDbRecord(created),
        created: true,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.dailySignalDelivery.findUnique({
          where: { dedupeKey: input.dedupeKey },
        });
        if (existing) {
          console.info("[dailySignalDeliveryRepository] resolved create collision", {
            dedupeKey: input.dedupeKey,
            existingDeliveryId: existing.id,
          });
          return {
            record: mapDbRecord(existing),
            created: false,
          };
        }
      }

      console.error("[dailySignalDeliveryRepository] create failed", error);
      if (allowsMemoryFallback()) {
        const now = new Date();
        const record: DailySignalDeliveryRecord = {
          id: createId("dsdel"),
          createdAt: now,
          updatedAt: now,
          lastAttemptAt: input.lastAttemptAt ?? null,
          deliveredAt: input.deliveredAt ?? null,
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
          throw new Error(`Daily signal delivery already exists for dedupeKey ${input.dedupeKey}`);
        }
      }

      throw new Error("Daily signal delivery persistence failed during create");
    }
  }

  async update(id: string, patch: UpdateDailySignalDeliveryInput): Promise<DailySignalDeliveryRecord> {
    return withStorageFallback(
      "update",
      async () => prisma.$transaction(async tx => {
        const current = await tx.dailySignalDelivery.findUnique({ where: { id } });
        if (!current) {
          throw new Error(`Daily signal delivery ${id} not found`);
        }
        const updated = await tx.dailySignalDelivery.update({
          where: { id },
          data: toUpdateInput(mapDbRecord(current), patch),
        });
        return mapDbRecord(updated);
      }),
      () => {
        const current = getMemoryStore().get(id);
        if (!current) {
          throw new Error(`Daily signal delivery ${id} not found`);
        }
        const updated: DailySignalDeliveryRecord = {
          ...current,
          ...patch,
          updatedAt: new Date(),
        };
        getMemoryStore().set(id, cloneRecord(updated));
        return cloneRecord(updated);
      },
    );
  }

  async listByRunId(runId: string): Promise<DailySignalDeliveryRecord[]> {
    return withStorageFallback(
      "listByRunId",
      async () => {
        const rows = await prisma.dailySignalDelivery.findMany({
          where: { dailySignalRunId: runId },
          orderBy: { createdAt: "asc" },
        });
        return rows.map(mapDbRecord);
      },
      () => [...getMemoryStore().values()]
        .filter(item => item.runId === runId)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
        .map(cloneRecord),
    );
  }
}
