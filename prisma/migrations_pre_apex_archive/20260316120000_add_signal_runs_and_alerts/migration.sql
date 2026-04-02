-- CreateTable
CREATE TABLE "SignalRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "engineVersion" TEXT NOT NULL,
    "featureVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,

    CONSTRAINT "SignalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Signal"
ADD COLUMN "runId" TEXT;

-- CreateTable for existing rows
INSERT INTO "SignalRun" ("id", "startedAt", "completedAt", "engineVersion", "featureVersion", "promptVersion", "status")
VALUES ('legacy-backfill-run', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'legacy', 'legacy', 'legacy', 'COMPLETED');

UPDATE "Signal"
SET "runId" = 'legacy-backfill-run'
WHERE "runId" IS NULL;

ALTER TABLE "Signal"
ALTER COLUMN "runId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Signal" ADD CONSTRAINT "Signal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SignalRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
