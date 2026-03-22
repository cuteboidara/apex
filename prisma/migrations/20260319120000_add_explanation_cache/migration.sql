CREATE TABLE "ExplanationCache" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "fallbackChain" JSONB,
    "content" TEXT NOT NULL,
    "errorMetadata" JSONB,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExplanationCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExplanationCache_fingerprint_purpose_key" ON "ExplanationCache"("fingerprint", "purpose");
CREATE INDEX "ExplanationCache_purpose_updatedAt_idx" ON "ExplanationCache"("purpose", "updatedAt");
