ALTER TABLE "TradePlan"
ADD COLUMN "providerAtSignal" TEXT,
ADD COLUMN "providerHealthStateAtSignal" TEXT,
ADD COLUMN "providerMarketStatusAtSignal" TEXT,
ADD COLUMN "providerFallbackUsedAtSignal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "qualityGateReason" TEXT,
ADD COLUMN "detectedAt" TIMESTAMP(3),
ADD COLUMN "entryHitAt" TIMESTAMP(3),
ADD COLUMN "stopHitAt" TIMESTAMP(3),
ADD COLUMN "tp1HitAt" TIMESTAMP(3),
ADD COLUMN "tp2HitAt" TIMESTAMP(3),
ADD COLUMN "tp3HitAt" TIMESTAMP(3),
ADD COLUMN "invalidatedAt" TIMESTAMP(3),
ADD COLUMN "expiredAt" TIMESTAMP(3),
ADD COLUMN "maxFavorableExcursion" DOUBLE PRECISION,
ADD COLUMN "maxAdverseExcursion" DOUBLE PRECISION,
ADD COLUMN "realizedRR" DOUBLE PRECISION,
ADD COLUMN "outcome" TEXT;

CREATE INDEX "TradePlan_symbol_detectedAt_idx" ON "TradePlan"("symbol", "detectedAt");
CREATE INDEX "TradePlan_style_outcome_idx" ON "TradePlan"("style", "outcome");
CREATE INDEX "TradePlan_providerHealthStateAtSignal_idx" ON "TradePlan"("providerHealthStateAtSignal");
