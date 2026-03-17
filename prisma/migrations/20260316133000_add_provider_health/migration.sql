-- CreateTable
CREATE TABLE "ProviderHealth" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "errorRate" DOUBLE PRECISION,
    "quotaRemaining" INTEGER,
    "status" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderHealth_pkey" PRIMARY KEY ("id")
);
