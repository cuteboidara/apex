-- AlterTable
ALTER TABLE "SignalRun"
ADD COLUMN "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "totalDurationMs" INTEGER,
ADD COLUMN "dataFetchDurationMs" INTEGER,
ADD COLUMN "scoringDurationMs" INTEGER,
ADD COLUMN "persistenceDurationMs" INTEGER,
ADD COLUMN "alertDispatchDurationMs" INTEGER,
ADD COLUMN "failureCode" TEXT,
ADD COLUMN "failureDetails" JSONB,
ALTER COLUMN "startedAt" DROP NOT NULL;

UPDATE "SignalRun"
SET "queuedAt" = COALESCE("startedAt", CURRENT_TIMESTAMP)
WHERE "queuedAt" IS NULL;

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "correlationId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
