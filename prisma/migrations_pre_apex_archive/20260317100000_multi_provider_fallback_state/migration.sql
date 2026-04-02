CREATE TABLE "MarketDataSnapshot" (
  "id" TEXT NOT NULL,
  "symbol" TEXT NOT NULL,
  "assetClass" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
  "price" DOUBLE PRECISION,
  "open" DOUBLE PRECISION,
  "high" DOUBLE PRECISION,
  "low" DOUBLE PRECISION,
  "close" DOUBLE PRECISION,
  "volume" DOUBLE PRECISION,
  "freshnessMs" INTEGER,
  "marketStatus" TEXT NOT NULL,
  "reason" TEXT,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketDataSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MarketDataSnapshot_symbol_timeframe_capturedAt_idx" ON "MarketDataSnapshot"("symbol", "timeframe", "capturedAt");

CREATE TABLE "ProviderCircuitState" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "assetClass" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "score" INTEGER NOT NULL DEFAULT 100,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "errorStreak" INTEGER NOT NULL DEFAULT 0,
  "openedAt" TIMESTAMP(3),
  "lastFailureAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "cooldownUntil" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProviderCircuitState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProviderCircuitState_provider_assetClass_key" ON "ProviderCircuitState"("provider", "assetClass");
