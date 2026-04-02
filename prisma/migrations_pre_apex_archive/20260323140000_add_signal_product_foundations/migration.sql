CREATE TABLE IF NOT EXISTS "Candle" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requestSymbol" TEXT,
    "sourceTimestamp" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,
    "quality" TEXT NOT NULL DEFAULT 'LIVE',
    "metadata" JSONB,
    CONSTRAINT "Candle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "QuoteSnapshot" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requestSymbol" TEXT,
    "sourceTimestamp" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "price" DOUBLE PRECISION NOT NULL,
    "bid" DOUBLE PRECISION,
    "ask" DOUBLE PRECISION,
    "change24h" DOUBLE PRECISION,
    "high14d" DOUBLE PRECISION,
    "low14d" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "freshnessMs" INTEGER,
    "marketStatus" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    CONSTRAINT "QuoteSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RegimeSnapshot" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "regimeTag" TEXT NOT NULL,
    "bias" TEXT,
    "score" INTEGER NOT NULL,
    "clarity" TEXT NOT NULL,
    "rangePct" DOUBLE PRECISION,
    "sourceTimestamp" TIMESTAMP(3) NOT NULL,
    "runId" TEXT,
    "signalId" TEXT,
    "tradePlanId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RegimeSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TradeOutcome" (
    "id" TEXT NOT NULL,
    "tradePlanId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "setupFamily" TEXT,
    "bias" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "providerAtSignal" TEXT,
    "providerHealthStateAtSignal" TEXT,
    "regimeTag" TEXT,
    "outcome" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION,
    "exitPrice" DOUBLE PRECISION,
    "realizedPnl" DOUBLE PRECISION,
    "realizedRR" DOUBLE PRECISION,
    "maxFavorableExcursion" DOUBLE PRECISION,
    "maxAdverseExcursion" DOUBLE PRECISION,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TradeOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StrategyPerformanceWindow" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "symbol" TEXT,
    "assetClass" TEXT,
    "style" TEXT,
    "setupFamily" TEXT,
    "regimeTag" TEXT,
    "provider" TEXT,
    "providerHealthState" TEXT,
    "lookbackDays" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION,
    "averageRR" DOUBLE PRECISION,
    "expectancy" DOUBLE PRECISION,
    "maxDrawdown" DOUBLE PRECISION,
    "confidenceMean" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyPerformanceWindow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ConfidenceCalibrationBucket" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "symbol" TEXT,
    "assetClass" TEXT,
    "style" TEXT,
    "setupFamily" TEXT,
    "regimeTag" TEXT,
    "provider" TEXT,
    "confidenceMin" INTEGER NOT NULL,
    "confidenceMax" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "winRate" DOUBLE PRECISION,
    "averageRR" DOUBLE PRECISION,
    "expectancy" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConfidenceCalibrationBucket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaperAccount" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "startingBalance" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "cashBalance" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "equity" DOUBLE PRECISION NOT NULL DEFAULT 10000,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaperAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaperPosition" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tradePlanId" TEXT,
    "signalId" TEXT,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit1" DOUBLE PRECISION,
    "takeProfit2" DOUBLE PRECISION,
    "takeProfit3" DOUBLE PRECISION,
    "currentPrice" DOUBLE PRECISION,
    "unrealizedPnl" DOUBLE PRECISION,
    "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaperPosition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExecutionFill" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "positionId" TEXT,
    "tradePlanId" TEXT,
    "signalId" TEXT,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "fee" DOUBLE PRECISION DEFAULT 0,
    "slippageBps" DOUBLE PRECISION,
    "spreadBps" DOUBLE PRECISION,
    "mode" TEXT NOT NULL DEFAULT 'PAPER',
    "venue" TEXT,
    "provider" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "ExecutionFill_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AlertDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "providerMessageId" TEXT,
    "providerResponse" TEXT,
    "detail" TEXT,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AlertDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DeadLetterJob" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "runId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FAILED',
    "attemptsMade" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "payload" JSONB,
    "correlationId" TEXT,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replayedAt" TIMESTAMP(3),
    "replayStatus" TEXT,
    "metadata" JSONB,
    CONSTRAINT "DeadLetterJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OperationalMetric" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT,
    "unit" TEXT,
    "value" DOUBLE PRECISION,
    "count" INTEGER,
    "provider" TEXT,
    "symbol" TEXT,
    "assetClass" TEXT,
    "runId" TEXT,
    "detail" TEXT,
    "tags" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationalMetric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BacktestRun" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "symbol" TEXT,
    "assetClass" TEXT,
    "timeframe" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "config" JSONB NOT NULL,
    "summary" JSONB,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BacktestTrade" (
    "id" TEXT NOT NULL,
    "backtestRunId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "signalTimestamp" TIMESTAMP(3) NOT NULL,
    "entryTimestamp" TIMESTAMP(3),
    "exitTimestamp" TIMESTAMP(3),
    "provider" TEXT,
    "regimeTag" TEXT,
    "setupFamily" TEXT,
    "confidence" INTEGER,
    "outcome" TEXT NOT NULL,
    "entryPrice" DOUBLE PRECISION,
    "exitPrice" DOUBLE PRECISION,
    "realizedPnl" DOUBLE PRECISION,
    "realizedRR" DOUBLE PRECISION,
    "maxFavorableExcursion" DOUBLE PRECISION,
    "maxAdverseExcursion" DOUBLE PRECISION,
    "metadata" JSONB,
    CONSTRAINT "BacktestTrade_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "monthlyPriceCents" INTEGER,
    "annualPriceCents" INTEGER,
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TRIAL',
    "seatCount" INTEGER NOT NULL DEFAULT 1,
    "billingCustomerId" TEXT,
    "billingSubscriptionId" TEXT,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "featureOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretHash" TEXT,
    "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastDeliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ExportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "scope" TEXT NOT NULL,
    "filter" JSONB,
    "filePath" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WatchlistAsset" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WatchlistAsset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT,
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "stylePreferences" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "subscribedSymbols" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "subscribedAssetClasses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailDigestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Candle_symbol_timeframe_provider_sourceTimestamp_key" ON "Candle"("symbol", "timeframe", "provider", "sourceTimestamp");
CREATE INDEX IF NOT EXISTS "Candle_symbol_timeframe_sourceTimestamp_idx" ON "Candle"("symbol", "timeframe", "sourceTimestamp");
CREATE INDEX IF NOT EXISTS "Candle_provider_sourceTimestamp_idx" ON "Candle"("provider", "sourceTimestamp");

CREATE UNIQUE INDEX IF NOT EXISTS "QuoteSnapshot_symbol_provider_sourceTimestamp_key" ON "QuoteSnapshot"("symbol", "provider", "sourceTimestamp");
CREATE INDEX IF NOT EXISTS "QuoteSnapshot_symbol_sourceTimestamp_idx" ON "QuoteSnapshot"("symbol", "sourceTimestamp");
CREATE INDEX IF NOT EXISTS "QuoteSnapshot_provider_sourceTimestamp_idx" ON "QuoteSnapshot"("provider", "sourceTimestamp");

CREATE INDEX IF NOT EXISTS "RegimeSnapshot_symbol_timeframe_sourceTimestamp_idx" ON "RegimeSnapshot"("symbol", "timeframe", "sourceTimestamp");
CREATE INDEX IF NOT EXISTS "RegimeSnapshot_runId_idx" ON "RegimeSnapshot"("runId");
CREATE INDEX IF NOT EXISTS "RegimeSnapshot_tradePlanId_idx" ON "RegimeSnapshot"("tradePlanId");

CREATE UNIQUE INDEX IF NOT EXISTS "TradeOutcome_tradePlanId_key" ON "TradeOutcome"("tradePlanId");
CREATE INDEX IF NOT EXISTS "TradeOutcome_symbol_closedAt_idx" ON "TradeOutcome"("symbol", "closedAt");
CREATE INDEX IF NOT EXISTS "TradeOutcome_style_outcome_idx" ON "TradeOutcome"("style", "outcome");
CREATE INDEX IF NOT EXISTS "TradeOutcome_regimeTag_idx" ON "TradeOutcome"("regimeTag");
CREATE INDEX IF NOT EXISTS "TradeOutcome_providerAtSignal_providerHealthStateAtSignal_idx" ON "TradeOutcome"("providerAtSignal", "providerHealthStateAtSignal");

CREATE INDEX IF NOT EXISTS "StrategyPerformanceWindow_scopeType_generatedAt_idx" ON "StrategyPerformanceWindow"("scopeType", "generatedAt");
CREATE INDEX IF NOT EXISTS "StrategyPerformanceWindow_symbol_style_generatedAt_idx" ON "StrategyPerformanceWindow"("symbol", "style", "generatedAt");
CREATE INDEX IF NOT EXISTS "StrategyPerformanceWindow_setupFamily_regimeTag_generatedAt_idx" ON "StrategyPerformanceWindow"("setupFamily", "regimeTag", "generatedAt");

CREATE INDEX IF NOT EXISTS "ConfidenceCalibrationBucket_scopeType_generatedAt_idx" ON "ConfidenceCalibrationBucket"("scopeType", "generatedAt");
CREATE INDEX IF NOT EXISTS "ConfidenceCalibrationBucket_symbol_style_generatedAt_idx" ON "ConfidenceCalibrationBucket"("symbol", "style", "generatedAt");
CREATE INDEX IF NOT EXISTS "ConfidenceCalibrationBucket_setupFamily_regimeTag_generatedAt_idx" ON "ConfidenceCalibrationBucket"("setupFamily", "regimeTag", "generatedAt");

CREATE INDEX IF NOT EXISTS "PaperAccount_ownerUserId_status_idx" ON "PaperAccount"("ownerUserId", "status");
CREATE INDEX IF NOT EXISTS "PaperAccount_teamId_status_idx" ON "PaperAccount"("teamId", "status");

CREATE INDEX IF NOT EXISTS "PaperPosition_accountId_status_idx" ON "PaperPosition"("accountId", "status");
CREATE INDEX IF NOT EXISTS "PaperPosition_symbol_status_idx" ON "PaperPosition"("symbol", "status");
CREATE INDEX IF NOT EXISTS "PaperPosition_tradePlanId_idx" ON "PaperPosition"("tradePlanId");

CREATE INDEX IF NOT EXISTS "ExecutionFill_accountId_occurredAt_idx" ON "ExecutionFill"("accountId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ExecutionFill_positionId_occurredAt_idx" ON "ExecutionFill"("positionId", "occurredAt");
CREATE INDEX IF NOT EXISTS "ExecutionFill_tradePlanId_idx" ON "ExecutionFill"("tradePlanId");

CREATE INDEX IF NOT EXISTS "AlertDeliveryAttempt_alertId_attemptedAt_idx" ON "AlertDeliveryAttempt"("alertId", "attemptedAt");
CREATE INDEX IF NOT EXISTS "AlertDeliveryAttempt_channel_attemptedAt_idx" ON "AlertDeliveryAttempt"("channel", "attemptedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "DeadLetterJob_jobId_key" ON "DeadLetterJob"("jobId");
CREATE INDEX IF NOT EXISTS "DeadLetterJob_queueName_failedAt_idx" ON "DeadLetterJob"("queueName", "failedAt");
CREATE INDEX IF NOT EXISTS "DeadLetterJob_runId_idx" ON "DeadLetterJob"("runId");

CREATE INDEX IF NOT EXISTS "OperationalMetric_metric_recordedAt_idx" ON "OperationalMetric"("metric", "recordedAt");
CREATE INDEX IF NOT EXISTS "OperationalMetric_category_recordedAt_idx" ON "OperationalMetric"("category", "recordedAt");
CREATE INDEX IF NOT EXISTS "OperationalMetric_provider_recordedAt_idx" ON "OperationalMetric"("provider", "recordedAt");
CREATE INDEX IF NOT EXISTS "OperationalMetric_symbol_recordedAt_idx" ON "OperationalMetric"("symbol", "recordedAt");

CREATE INDEX IF NOT EXISTS "BacktestRun_status_startedAt_idx" ON "BacktestRun"("status", "startedAt");
CREATE INDEX IF NOT EXISTS "BacktestRun_symbol_startedAt_idx" ON "BacktestRun"("symbol", "startedAt");

CREATE INDEX IF NOT EXISTS "BacktestTrade_backtestRunId_signalTimestamp_idx" ON "BacktestTrade"("backtestRunId", "signalTimestamp");
CREATE INDEX IF NOT EXISTS "BacktestTrade_symbol_outcome_idx" ON "BacktestTrade"("symbol", "outcome");
CREATE INDEX IF NOT EXISTS "BacktestTrade_setupFamily_regimeTag_idx" ON "BacktestTrade"("setupFamily", "regimeTag");

CREATE UNIQUE INDEX IF NOT EXISTS "SubscriptionPlan_slug_key" ON "SubscriptionPlan"("slug");

CREATE INDEX IF NOT EXISTS "UserSubscription_userId_status_idx" ON "UserSubscription"("userId", "status");
CREATE INDEX IF NOT EXISTS "UserSubscription_billingCustomerId_idx" ON "UserSubscription"("billingCustomerId");

CREATE UNIQUE INDEX IF NOT EXISTS "Team_slug_key" ON "Team"("slug");

CREATE UNIQUE INDEX IF NOT EXISTS "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");
CREATE INDEX IF NOT EXISTS "TeamMember_userId_status_idx" ON "TeamMember"("userId", "status");

CREATE UNIQUE INDEX IF NOT EXISTS "ApiToken_tokenHash_key" ON "ApiToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "ApiToken_userId_revokedAt_idx" ON "ApiToken"("userId", "revokedAt");

CREATE INDEX IF NOT EXISTS "WebhookEndpoint_userId_status_idx" ON "WebhookEndpoint"("userId", "status");
CREATE INDEX IF NOT EXISTS "WebhookEndpoint_teamId_status_idx" ON "WebhookEndpoint"("teamId", "status");

CREATE INDEX IF NOT EXISTS "ExportJob_userId_status_idx" ON "ExportJob"("userId", "status");
CREATE INDEX IF NOT EXISTS "ExportJob_teamId_status_idx" ON "ExportJob"("teamId", "status");

CREATE INDEX IF NOT EXISTS "Watchlist_userId_updatedAt_idx" ON "Watchlist"("userId", "updatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "WatchlistAsset_watchlistId_symbol_key" ON "WatchlistAsset"("watchlistId", "symbol");

CREATE UNIQUE INDEX IF NOT EXISTS "UserPreference_userId_key" ON "UserPreference"("userId");
