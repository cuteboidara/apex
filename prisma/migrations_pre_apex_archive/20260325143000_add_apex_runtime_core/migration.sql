-- CreateTable
CREATE TABLE "MarketEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "tsExchange" TIMESTAMP(3) NOT NULL,
    "tsReceived" TIMESTAMP(3) NOT NULL,
    "venue" TEXT NOT NULL,
    "symbolCanonical" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "integrityFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureSnapshot" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "symbolCanonical" TEXT NOT NULL,
    "horizon" TEXT NOT NULL,
    "features" JSONB NOT NULL,
    "quality" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PodOutput" (
    "id" TEXT NOT NULL,
    "podId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "symbolCanonical" TEXT NOT NULL,
    "decisionHorizon" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "recommendedAction" TEXT,
    "expectedReturn" DOUBLE PRECISION,
    "expectedVolatility" DOUBLE PRECISION,
    "winProbability" DOUBLE PRECISION,
    "urgency" DOUBLE PRECISION,
    "stateAssessment" TEXT,
    "constraints" JSONB NOT NULL,
    "diagnostics" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PodOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationIntent" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "symbolCanonical" TEXT NOT NULL,
    "selectedPods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "podWeights" JSONB NOT NULL,
    "targetPosition" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "portfolioContext" JSONB NOT NULL,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskDecision" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "scope" TEXT NOT NULL,
    "symbolCanonical" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL,
    "approvedSizeMultiplier" DOUBLE PRECISION NOT NULL,
    "riskCheckResults" JSONB NOT NULL,
    "overrideInstructions" TEXT,
    "deRiskingAction" TEXT NOT NULL DEFAULT 'none',
    "killSwitchActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionIntent" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "symbolCanonical" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "targetSize" DOUBLE PRECISION NOT NULL,
    "urgency" DOUBLE PRECISION NOT NULL,
    "executionStyle" TEXT NOT NULL,
    "slippageBudgetBps" DOUBLE PRECISION NOT NULL,
    "constraints" JSONB NOT NULL,
    "fallbackStyle" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChildOrder" (
    "id" TEXT NOT NULL,
    "childOrderId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "symbolCanonical" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "executionStyle" TEXT NOT NULL,
    "limitPrice" DOUBLE PRECISION,
    "expectedSlippageBps" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChildOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionJournal" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "symbolCanonical" TEXT NOT NULL,
    "marketSnapshotRef" TEXT NOT NULL,
    "podOutputRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allocationRef" TEXT NOT NULL,
    "riskDecisionRef" TEXT NOT NULL,
    "executionIntentRef" TEXT NOT NULL,
    "finalAction" TEXT NOT NULL,
    "humanSummary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningFeedback" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "decisionRef" TEXT NOT NULL,
    "outcomeWindow" TEXT NOT NULL,
    "realizedPnl" DOUBLE PRECISION,
    "realizedSlippageBps" DOUBLE PRECISION,
    "forecastAccuracy" DOUBLE PRECISION,
    "attribution" JSONB NOT NULL,
    "driftFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedUpdateScope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelRegistry" (
    "id" TEXT NOT NULL,
    "podId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "trainedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "validationScore" DOUBLE PRECISION NOT NULL,
    "deploymentStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriftLog" (
    "id" TEXT NOT NULL,
    "podId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "predictionAccuracy7d" DOUBLE PRECISION NOT NULL,
    "predictionAccuracy30d" DOUBLE PRECISION NOT NULL,
    "confidenceCalibrationError" DOUBLE PRECISION NOT NULL,
    "featureDistributionShift" DOUBLE PRECISION NOT NULL,
    "driftFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommendedUpdateScope" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriftLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "module" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketEvent_eventId_key" ON "MarketEvent"("eventId");
CREATE INDEX "MarketEvent_symbolCanonical_tsExchange_idx" ON "MarketEvent"("symbolCanonical", "tsExchange");
CREATE INDEX "MarketEvent_venue_tsReceived_idx" ON "MarketEvent"("venue", "tsReceived");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureSnapshot_snapshotId_key" ON "FeatureSnapshot"("snapshotId");
CREATE INDEX "FeatureSnapshot_symbolCanonical_ts_idx" ON "FeatureSnapshot"("symbolCanonical", "ts");
CREATE INDEX "FeatureSnapshot_horizon_ts_idx" ON "FeatureSnapshot"("horizon", "ts");

-- CreateIndex
CREATE INDEX "PodOutput_podId_ts_idx" ON "PodOutput"("podId", "ts");
CREATE INDEX "PodOutput_symbolCanonical_ts_idx" ON "PodOutput"("symbolCanonical", "ts");

-- CreateIndex
CREATE INDEX "AllocationIntent_symbolCanonical_ts_idx" ON "AllocationIntent"("symbolCanonical", "ts");

-- CreateIndex
CREATE INDEX "RiskDecision_symbolCanonical_ts_idx" ON "RiskDecision"("symbolCanonical", "ts");
CREATE INDEX "RiskDecision_approvalStatus_ts_idx" ON "RiskDecision"("approvalStatus", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionIntent_intentId_key" ON "ExecutionIntent"("intentId");
CREATE INDEX "ExecutionIntent_symbolCanonical_ts_idx" ON "ExecutionIntent"("symbolCanonical", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "ChildOrder_childOrderId_key" ON "ChildOrder"("childOrderId");
CREATE INDEX "ChildOrder_intentId_ts_idx" ON "ChildOrder"("intentId", "ts");
CREATE INDEX "ChildOrder_symbolCanonical_ts_idx" ON "ChildOrder"("symbolCanonical", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionJournal_decisionId_key" ON "DecisionJournal"("decisionId");
CREATE INDEX "DecisionJournal_symbolCanonical_ts_idx" ON "DecisionJournal"("symbolCanonical", "ts");
CREATE INDEX "DecisionJournal_finalAction_ts_idx" ON "DecisionJournal"("finalAction", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "LearningFeedback_feedbackId_key" ON "LearningFeedback"("feedbackId");
CREATE INDEX "LearningFeedback_decisionRef_createdAt_idx" ON "LearningFeedback"("decisionRef", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelRegistry_podId_version_key" ON "ModelRegistry"("podId", "version");
CREATE INDEX "ModelRegistry_podId_trainedAt_idx" ON "ModelRegistry"("podId", "trainedAt");

-- CreateIndex
CREATE INDEX "DriftLog_podId_ts_idx" ON "DriftLog"("podId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "SystemEvent_eventId_key" ON "SystemEvent"("eventId");
CREATE INDEX "SystemEvent_module_ts_idx" ON "SystemEvent"("module", "ts");
CREATE INDEX "SystemEvent_type_ts_idx" ON "SystemEvent"("type", "ts");
