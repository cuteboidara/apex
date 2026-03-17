CREATE TABLE "TradePlan" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "bias" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "timeframe" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "entryMin" DOUBLE PRECISION,
    "entryMax" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit1" DOUBLE PRECISION,
    "takeProfit2" DOUBLE PRECISION,
    "takeProfit3" DOUBLE PRECISION,
    "riskRewardRatio" DOUBLE PRECISION,
    "invalidationLevel" DOUBLE PRECISION,
    "thesis" TEXT NOT NULL,
    "executionNotes" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradePlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TradePlan_runId_idx" ON "TradePlan"("runId");
CREATE INDEX "TradePlan_signalId_idx" ON "TradePlan"("signalId");
CREATE INDEX "TradePlan_symbol_style_createdAt_idx" ON "TradePlan"("symbol", "style", "createdAt");

ALTER TABLE "TradePlan"
ADD CONSTRAINT "TradePlan_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SignalRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TradePlan"
ADD CONSTRAINT "TradePlan_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "Signal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
