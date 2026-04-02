-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "apex";

-- CreateTable
CREATE TABLE "apex"."User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "hashedPassword" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "suspendedReason" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "loginCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."Setup" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "macro" INTEGER NOT NULL,
    "structure" INTEGER NOT NULL,
    "zones" INTEGER NOT NULL,
    "technical" INTEGER NOT NULL,
    "timing" INTEGER NOT NULL,
    "reasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Setup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."TradeLog" (
    "id" TEXT NOT NULL,
    "setupId" TEXT NOT NULL,
    "entry" DOUBLE PRECISION,
    "exit" DOUBLE PRECISION,
    "pnl" DOUBLE PRECISION,
    "notes" TEXT,
    "outcome" TEXT,

    CONSTRAINT "TradeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."Signal" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "macro" INTEGER NOT NULL,
    "structure" INTEGER NOT NULL,
    "zones" INTEGER NOT NULL,
    "technical" INTEGER NOT NULL,
    "timing" INTEGER NOT NULL,
    "entry" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "tp1" DOUBLE PRECISION,
    "tp2" DOUBLE PRECISION,
    "tp3" DOUBLE PRECISION,
    "brief" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "sentTelegram" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiExplanation" TEXT,
    "aiRiskAssessment" TEXT,
    "aiMarketContext" TEXT,
    "aiEntryRefinement" TEXT,
    "aiInvalidationLevel" TEXT,
    "aiUnifiedAnalysis" TEXT,
    "aiGptConfidence" INTEGER,
    "aiClaudeConfidence" INTEGER,
    "aiGeminiConfidence" INTEGER,
    "aiVerdict" TEXT,
    "aiGeneratedAt" TIMESTAMP(3),

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."TelegramSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minRank" TEXT NOT NULL DEFAULT 'A',
    "allowedAssets" TEXT NOT NULL DEFAULT 'ALL',
    "weekendCryptoOnly" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."SignalRun" (
    "id" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "totalDurationMs" INTEGER,
    "dataFetchDurationMs" INTEGER,
    "scoringDurationMs" INTEGER,
    "persistenceDurationMs" INTEGER,
    "alertDispatchDurationMs" INTEGER,
    "engineVersion" TEXT NOT NULL,
    "featureVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "failureDetails" JSONB,

    CONSTRAINT "SignalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."DailySignalRun" (
    "id" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "triggeredBy" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "forced" BOOLEAN NOT NULL DEFAULT false,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "zeroSignalDay" BOOLEAN NOT NULL DEFAULT false,
    "generatedCount" INTEGER NOT NULL DEFAULT 0,
    "publishedCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "signalSnapshot" JSONB,
    "publicationPolicy" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySignalRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."DailySignalDelivery" (
    "id" TEXT NOT NULL,
    "dailySignalRunId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "signalCount" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "payloadSnapshot" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailySignalDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."TradePlan" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "setupFamily" TEXT,
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
    "regimeTag" TEXT,
    "liquidityThesis" TEXT,
    "trapThesis" TEXT,
    "setupScore" INTEGER,
    "publicationRank" TEXT,
    "thesis" TEXT NOT NULL,
    "executionNotes" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerAtSignal" TEXT,
    "providerHealthStateAtSignal" TEXT,
    "providerMarketStatusAtSignal" TEXT,
    "providerFallbackUsedAtSignal" BOOLEAN NOT NULL DEFAULT false,
    "qualityGateReason" TEXT,
    "detectedAt" TIMESTAMP(3),
    "entryHitAt" TIMESTAMP(3),
    "stopHitAt" TIMESTAMP(3),
    "tp1HitAt" TIMESTAMP(3),
    "tp2HitAt" TIMESTAMP(3),
    "tp3HitAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "maxFavorableExcursion" DOUBLE PRECISION,
    "maxAdverseExcursion" DOUBLE PRECISION,
    "realizedRR" DOUBLE PRECISION,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."Alert" (
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

-- CreateTable
CREATE TABLE "apex"."TelegramSubscriber" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "languageCode" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'FREE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "alertAssets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alertRanks" TEXT[] DEFAULT ARRAY['S', 'A', 'B']::TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."ProviderHealth" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "requestSymbol" TEXT,
    "detail" TEXT,
    "latencyMs" INTEGER,
    "errorRate" DOUBLE PRECISION,
    "quotaRemaining" INTEGER,
    "status" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."MarketDataSnapshot" (
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

-- CreateTable
CREATE TABLE "apex"."ProviderCircuitState" (
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

-- CreateTable
CREATE TABLE "apex"."AuditEvent" (
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

-- CreateTable
CREATE TABLE "apex"."ExplanationCache" (
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

-- CreateTable
CREATE TABLE "apex"."Candle" (
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

-- CreateTable
CREATE TABLE "apex"."QuoteSnapshot" (
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

-- CreateTable
CREATE TABLE "apex"."RegimeSnapshot" (
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

-- CreateTable
CREATE TABLE "apex"."TradeOutcome" (
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

-- CreateTable
CREATE TABLE "apex"."StrategyPerformanceWindow" (
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

-- CreateTable
CREATE TABLE "apex"."ConfidenceCalibrationBucket" (
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

-- CreateTable
CREATE TABLE "apex"."PaperAccount" (
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

-- CreateTable
CREATE TABLE "apex"."PaperPosition" (
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

-- CreateTable
CREATE TABLE "apex"."ExecutionFill" (
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

-- CreateTable
CREATE TABLE "apex"."AlertDeliveryAttempt" (
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

-- CreateTable
CREATE TABLE "apex"."DeadLetterJob" (
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

-- CreateTable
CREATE TABLE "apex"."OperationalMetric" (
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

-- CreateTable
CREATE TABLE "apex"."BacktestRun" (
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

-- CreateTable
CREATE TABLE "apex"."BacktestTrade" (
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

-- CreateTable
CREATE TABLE "apex"."SubscriptionPlan" (
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

-- CreateTable
CREATE TABLE "apex"."UserSubscription" (
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

-- CreateTable
CREATE TABLE "apex"."Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."ApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "teamId" TEXT,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretHash" TEXT,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastDeliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."ExportJob" (
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

-- CreateTable
CREATE TABLE "apex"."Watchlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."WatchlistAsset" (
    "id" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchlistAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."UserPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT,
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "stylePreferences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subscribedSymbols" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subscribedAssetClasses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailDigestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."MarketEvent" (
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
CREATE TABLE "apex"."FeatureSnapshot" (
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
CREATE TABLE "apex"."PodOutput" (
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
CREATE TABLE "apex"."AllocationIntent" (
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
CREATE TABLE "apex"."RiskDecision" (
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
CREATE TABLE "apex"."ExecutionIntent" (
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
CREATE TABLE "apex"."ChildOrder" (
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
CREATE TABLE "apex"."DecisionJournal" (
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
CREATE TABLE "apex"."LearningFeedback" (
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
CREATE TABLE "apex"."ModelRegistry" (
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
CREATE TABLE "apex"."DriftLog" (
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
CREATE TABLE "apex"."SystemEvent" (
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

-- CreateTable
CREATE TABLE "apex"."SignalLog" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "setupType" TEXT,
    "session" TEXT,
    "bias" TEXT,
    "confidence" DOUBLE PRECISION,
    "entry" DOUBLE PRECISION,
    "sl" DOUBLE PRECISION,
    "tp1" DOUBLE PRECISION,
    "tp2" DOUBLE PRECISION,
    "tp3" DOUBLE PRECISION,
    "livePrice" DOUBLE PRECISION,
    "noTradeReason" TEXT,
    "shortReasoning" TEXT,
    "marketPhase" TEXT,
    "location" TEXT,
    "zoneType" TEXT,
    "podVoteSummary" TEXT,
    "blockedReasons" TEXT,
    "cycleId" TEXT,
    "emittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "outcomeAt" TIMESTAMP(3),
    "outcomePrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignalLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."OperatorSettings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."MarketSnapshot" (
    "id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "features" JSONB NOT NULL,
    "raw_inputs_metadata" JSONB NOT NULL,
    "data_source" TEXT NOT NULL,
    "data_quality_tier" TEXT NOT NULL,
    "feature_version" TEXT NOT NULL,
    "market_session_context" JSONB NOT NULL,
    "publication_session_window" TEXT NOT NULL,
    "session_context" JSONB NOT NULL,
    "data_fetch_timestamps" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."TradeCandidate" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "size_hint" DOUBLE PRECISION NOT NULL,
    "allocator_version" TEXT NOT NULL,
    "pod_votes" JSONB NOT NULL,
    "supporting_evidence" JSONB NOT NULL,
    "allocator_metadata" JSONB,
    "directional_attribution" JSONB,
    "veto_attribution" JSONB,
    "confidence_breakdown" JSONB,
    "proposed_trade_plan" JSONB,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradeCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."RiskEvaluatedCandidate" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "blocking_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "size_adjustments" JSONB,
    "policy_evaluations" JSONB NOT NULL,
    "risk_version" TEXT NOT NULL,
    "approved_trade_plan" JSONB,
    "authoritative_source" TEXT,
    "shadow_decision" TEXT,
    "shadow_mismatch" BOOLEAN NOT NULL DEFAULT false,
    "shadow_blocking_rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shadow_adjustments" JSONB,
    "explainability_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskEvaluatedCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."RiskShadowLog" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "legacyDecision" TEXT NOT NULL,
    "shadowDecision" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL,
    "divergentRules" TEXT NOT NULL,
    "legacyRuleCodes" TEXT NOT NULL,
    "shadowRuleCodes" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskShadowLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."ExecutableSignal" (
    "id" TEXT NOT NULL,
    "signal_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "entry" DOUBLE PRECISION NOT NULL,
    "stop_loss" DOUBLE PRECISION NOT NULL,
    "take_profit" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "version" TEXT NOT NULL,

    CONSTRAINT "ExecutableSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."SignalLifecycle" (
    "id" TEXT NOT NULL,
    "signal_id" TEXT NOT NULL,
    "current_state" TEXT NOT NULL,
    "fill_status" TEXT NOT NULL,
    "opened_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "pnl" DOUBLE PRECISION,
    "execution_events" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalLifecycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."SignalViewModel" (
    "id" TEXT NOT NULL,
    "view_id" TEXT NOT NULL,
    "entity_ref" TEXT NOT NULL,
    "display_type" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reason_labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confidence_label" TEXT,
    "ui_sections" JSONB NOT NULL,
    "commentary" JSONB,
    "ui_version" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignalViewModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apex"."CycleOutput" (
    "id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "symbols_processed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "snapshots" JSONB NOT NULL,
    "candidates" JSONB NOT NULL,
    "risk_results" JSONB NOT NULL,
    "signals" JSONB NOT NULL,
    "metadata" JSONB NOT NULL,
    "versions" JSONB NOT NULL,
    "pipeline_status" TEXT NOT NULL,
    "payload_source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CycleOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "apex"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TradeLog_setupId_key" ON "apex"."TradeLog"("setupId");

-- CreateIndex
CREATE UNIQUE INDEX "DailySignalRun_windowKey_key" ON "apex"."DailySignalRun"("windowKey");

-- CreateIndex
CREATE INDEX "DailySignalRun_runDate_timezone_idx" ON "apex"."DailySignalRun"("runDate", "timezone");

-- CreateIndex
CREATE INDEX "DailySignalRun_status_scheduledFor_idx" ON "apex"."DailySignalRun"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "DailySignalDelivery_dedupeKey_key" ON "apex"."DailySignalDelivery"("dedupeKey");

-- CreateIndex
CREATE INDEX "DailySignalDelivery_dailySignalRunId_status_idx" ON "apex"."DailySignalDelivery"("dailySignalRunId", "status");

-- CreateIndex
CREATE INDEX "DailySignalDelivery_channel_status_createdAt_idx" ON "apex"."DailySignalDelivery"("channel", "status", "createdAt");

-- CreateIndex
CREATE INDEX "TradePlan_symbol_detectedAt_idx" ON "apex"."TradePlan"("symbol", "detectedAt");

-- CreateIndex
CREATE INDEX "TradePlan_style_outcome_idx" ON "apex"."TradePlan"("style", "outcome");

-- CreateIndex
CREATE INDEX "TradePlan_providerHealthStateAtSignal_idx" ON "apex"."TradePlan"("providerHealthStateAtSignal");

-- CreateIndex
CREATE UNIQUE INDEX "TradePlan_signalId_style_key" ON "apex"."TradePlan"("signalId", "style");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramSubscriber_chatId_key" ON "apex"."TelegramSubscriber"("chatId");

-- CreateIndex
CREATE INDEX "MarketDataSnapshot_symbol_timeframe_capturedAt_idx" ON "apex"."MarketDataSnapshot"("symbol", "timeframe", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCircuitState_provider_assetClass_key" ON "apex"."ProviderCircuitState"("provider", "assetClass");

-- CreateIndex
CREATE INDEX "ExplanationCache_purpose_updatedAt_idx" ON "apex"."ExplanationCache"("purpose", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExplanationCache_fingerprint_purpose_key" ON "apex"."ExplanationCache"("fingerprint", "purpose");

-- CreateIndex
CREATE INDEX "Candle_symbol_timeframe_sourceTimestamp_idx" ON "apex"."Candle"("symbol", "timeframe", "sourceTimestamp");

-- CreateIndex
CREATE INDEX "Candle_provider_sourceTimestamp_idx" ON "apex"."Candle"("provider", "sourceTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "Candle_symbol_timeframe_provider_sourceTimestamp_key" ON "apex"."Candle"("symbol", "timeframe", "provider", "sourceTimestamp");

-- CreateIndex
CREATE INDEX "QuoteSnapshot_symbol_sourceTimestamp_idx" ON "apex"."QuoteSnapshot"("symbol", "sourceTimestamp");

-- CreateIndex
CREATE INDEX "QuoteSnapshot_provider_sourceTimestamp_idx" ON "apex"."QuoteSnapshot"("provider", "sourceTimestamp");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteSnapshot_symbol_provider_sourceTimestamp_key" ON "apex"."QuoteSnapshot"("symbol", "provider", "sourceTimestamp");

-- CreateIndex
CREATE INDEX "RegimeSnapshot_symbol_timeframe_sourceTimestamp_idx" ON "apex"."RegimeSnapshot"("symbol", "timeframe", "sourceTimestamp");

-- CreateIndex
CREATE INDEX "RegimeSnapshot_runId_idx" ON "apex"."RegimeSnapshot"("runId");

-- CreateIndex
CREATE INDEX "RegimeSnapshot_tradePlanId_idx" ON "apex"."RegimeSnapshot"("tradePlanId");

-- CreateIndex
CREATE UNIQUE INDEX "TradeOutcome_tradePlanId_key" ON "apex"."TradeOutcome"("tradePlanId");

-- CreateIndex
CREATE INDEX "TradeOutcome_symbol_closedAt_idx" ON "apex"."TradeOutcome"("symbol", "closedAt");

-- CreateIndex
CREATE INDEX "TradeOutcome_style_outcome_idx" ON "apex"."TradeOutcome"("style", "outcome");

-- CreateIndex
CREATE INDEX "TradeOutcome_regimeTag_idx" ON "apex"."TradeOutcome"("regimeTag");

-- CreateIndex
CREATE INDEX "TradeOutcome_providerAtSignal_providerHealthStateAtSignal_idx" ON "apex"."TradeOutcome"("providerAtSignal", "providerHealthStateAtSignal");

-- CreateIndex
CREATE INDEX "StrategyPerformanceWindow_scopeType_generatedAt_idx" ON "apex"."StrategyPerformanceWindow"("scopeType", "generatedAt");

-- CreateIndex
CREATE INDEX "StrategyPerformanceWindow_symbol_style_generatedAt_idx" ON "apex"."StrategyPerformanceWindow"("symbol", "style", "generatedAt");

-- CreateIndex
CREATE INDEX "StrategyPerformanceWindow_setupFamily_regimeTag_generatedAt_idx" ON "apex"."StrategyPerformanceWindow"("setupFamily", "regimeTag", "generatedAt");

-- CreateIndex
CREATE INDEX "ConfidenceCalibrationBucket_scopeType_generatedAt_idx" ON "apex"."ConfidenceCalibrationBucket"("scopeType", "generatedAt");

-- CreateIndex
CREATE INDEX "ConfidenceCalibrationBucket_symbol_style_generatedAt_idx" ON "apex"."ConfidenceCalibrationBucket"("symbol", "style", "generatedAt");

-- CreateIndex
CREATE INDEX "ConfidenceCalibrationBucket_setupFamily_regimeTag_generated_idx" ON "apex"."ConfidenceCalibrationBucket"("setupFamily", "regimeTag", "generatedAt");

-- CreateIndex
CREATE INDEX "PaperAccount_ownerUserId_status_idx" ON "apex"."PaperAccount"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "PaperAccount_teamId_status_idx" ON "apex"."PaperAccount"("teamId", "status");

-- CreateIndex
CREATE INDEX "PaperPosition_accountId_status_idx" ON "apex"."PaperPosition"("accountId", "status");

-- CreateIndex
CREATE INDEX "PaperPosition_symbol_status_idx" ON "apex"."PaperPosition"("symbol", "status");

-- CreateIndex
CREATE INDEX "PaperPosition_tradePlanId_idx" ON "apex"."PaperPosition"("tradePlanId");

-- CreateIndex
CREATE INDEX "ExecutionFill_accountId_occurredAt_idx" ON "apex"."ExecutionFill"("accountId", "occurredAt");

-- CreateIndex
CREATE INDEX "ExecutionFill_positionId_occurredAt_idx" ON "apex"."ExecutionFill"("positionId", "occurredAt");

-- CreateIndex
CREATE INDEX "ExecutionFill_tradePlanId_idx" ON "apex"."ExecutionFill"("tradePlanId");

-- CreateIndex
CREATE INDEX "AlertDeliveryAttempt_alertId_attemptedAt_idx" ON "apex"."AlertDeliveryAttempt"("alertId", "attemptedAt");

-- CreateIndex
CREATE INDEX "AlertDeliveryAttempt_channel_attemptedAt_idx" ON "apex"."AlertDeliveryAttempt"("channel", "attemptedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeadLetterJob_jobId_key" ON "apex"."DeadLetterJob"("jobId");

-- CreateIndex
CREATE INDEX "DeadLetterJob_queueName_failedAt_idx" ON "apex"."DeadLetterJob"("queueName", "failedAt");

-- CreateIndex
CREATE INDEX "DeadLetterJob_runId_idx" ON "apex"."DeadLetterJob"("runId");

-- CreateIndex
CREATE INDEX "OperationalMetric_metric_recordedAt_idx" ON "apex"."OperationalMetric"("metric", "recordedAt");

-- CreateIndex
CREATE INDEX "OperationalMetric_category_recordedAt_idx" ON "apex"."OperationalMetric"("category", "recordedAt");

-- CreateIndex
CREATE INDEX "OperationalMetric_provider_recordedAt_idx" ON "apex"."OperationalMetric"("provider", "recordedAt");

-- CreateIndex
CREATE INDEX "OperationalMetric_symbol_recordedAt_idx" ON "apex"."OperationalMetric"("symbol", "recordedAt");

-- CreateIndex
CREATE INDEX "BacktestRun_status_startedAt_idx" ON "apex"."BacktestRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "BacktestRun_symbol_startedAt_idx" ON "apex"."BacktestRun"("symbol", "startedAt");

-- CreateIndex
CREATE INDEX "BacktestTrade_backtestRunId_signalTimestamp_idx" ON "apex"."BacktestTrade"("backtestRunId", "signalTimestamp");

-- CreateIndex
CREATE INDEX "BacktestTrade_symbol_outcome_idx" ON "apex"."BacktestTrade"("symbol", "outcome");

-- CreateIndex
CREATE INDEX "BacktestTrade_setupFamily_regimeTag_idx" ON "apex"."BacktestTrade"("setupFamily", "regimeTag");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPlan_slug_key" ON "apex"."SubscriptionPlan"("slug");

-- CreateIndex
CREATE INDEX "UserSubscription_userId_status_idx" ON "apex"."UserSubscription"("userId", "status");

-- CreateIndex
CREATE INDEX "UserSubscription_billingCustomerId_idx" ON "apex"."UserSubscription"("billingCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "apex"."Team"("slug");

-- CreateIndex
CREATE INDEX "TeamMember_userId_status_idx" ON "apex"."TeamMember"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "apex"."TeamMember"("teamId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "apex"."ApiToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiToken_userId_revokedAt_idx" ON "apex"."ApiToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_userId_status_idx" ON "apex"."WebhookEndpoint"("userId", "status");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_teamId_status_idx" ON "apex"."WebhookEndpoint"("teamId", "status");

-- CreateIndex
CREATE INDEX "ExportJob_userId_status_idx" ON "apex"."ExportJob"("userId", "status");

-- CreateIndex
CREATE INDEX "ExportJob_teamId_status_idx" ON "apex"."ExportJob"("teamId", "status");

-- CreateIndex
CREATE INDEX "Watchlist_userId_updatedAt_idx" ON "apex"."Watchlist"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistAsset_watchlistId_symbol_key" ON "apex"."WatchlistAsset"("watchlistId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "UserPreference_userId_key" ON "apex"."UserPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketEvent_eventId_key" ON "apex"."MarketEvent"("eventId");

-- CreateIndex
CREATE INDEX "MarketEvent_symbolCanonical_tsExchange_idx" ON "apex"."MarketEvent"("symbolCanonical", "tsExchange");

-- CreateIndex
CREATE INDEX "MarketEvent_venue_tsReceived_idx" ON "apex"."MarketEvent"("venue", "tsReceived");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureSnapshot_snapshotId_key" ON "apex"."FeatureSnapshot"("snapshotId");

-- CreateIndex
CREATE INDEX "FeatureSnapshot_symbolCanonical_ts_idx" ON "apex"."FeatureSnapshot"("symbolCanonical", "ts");

-- CreateIndex
CREATE INDEX "FeatureSnapshot_horizon_ts_idx" ON "apex"."FeatureSnapshot"("horizon", "ts");

-- CreateIndex
CREATE INDEX "PodOutput_podId_ts_idx" ON "apex"."PodOutput"("podId", "ts");

-- CreateIndex
CREATE INDEX "PodOutput_symbolCanonical_ts_idx" ON "apex"."PodOutput"("symbolCanonical", "ts");

-- CreateIndex
CREATE INDEX "AllocationIntent_symbolCanonical_ts_idx" ON "apex"."AllocationIntent"("symbolCanonical", "ts");

-- CreateIndex
CREATE INDEX "RiskDecision_symbolCanonical_ts_idx" ON "apex"."RiskDecision"("symbolCanonical", "ts");

-- CreateIndex
CREATE INDEX "RiskDecision_approvalStatus_ts_idx" ON "apex"."RiskDecision"("approvalStatus", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutionIntent_intentId_key" ON "apex"."ExecutionIntent"("intentId");

-- CreateIndex
CREATE INDEX "ExecutionIntent_symbolCanonical_ts_idx" ON "apex"."ExecutionIntent"("symbolCanonical", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "ChildOrder_childOrderId_key" ON "apex"."ChildOrder"("childOrderId");

-- CreateIndex
CREATE INDEX "ChildOrder_intentId_ts_idx" ON "apex"."ChildOrder"("intentId", "ts");

-- CreateIndex
CREATE INDEX "ChildOrder_symbolCanonical_ts_idx" ON "apex"."ChildOrder"("symbolCanonical", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionJournal_decisionId_key" ON "apex"."DecisionJournal"("decisionId");

-- CreateIndex
CREATE INDEX "DecisionJournal_symbolCanonical_ts_idx" ON "apex"."DecisionJournal"("symbolCanonical", "ts");

-- CreateIndex
CREATE INDEX "DecisionJournal_finalAction_ts_idx" ON "apex"."DecisionJournal"("finalAction", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "LearningFeedback_feedbackId_key" ON "apex"."LearningFeedback"("feedbackId");

-- CreateIndex
CREATE INDEX "LearningFeedback_decisionRef_createdAt_idx" ON "apex"."LearningFeedback"("decisionRef", "createdAt");

-- CreateIndex
CREATE INDEX "ModelRegistry_podId_trainedAt_idx" ON "apex"."ModelRegistry"("podId", "trainedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelRegistry_podId_version_key" ON "apex"."ModelRegistry"("podId", "version");

-- CreateIndex
CREATE INDEX "DriftLog_podId_ts_idx" ON "apex"."DriftLog"("podId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "SystemEvent_eventId_key" ON "apex"."SystemEvent"("eventId");

-- CreateIndex
CREATE INDEX "SystemEvent_module_ts_idx" ON "apex"."SystemEvent"("module", "ts");

-- CreateIndex
CREATE INDEX "SystemEvent_type_ts_idx" ON "apex"."SystemEvent"("type", "ts");

-- CreateIndex
CREATE INDEX "SignalLog_symbol_emittedAt_idx" ON "apex"."SignalLog"("symbol", "emittedAt");

-- CreateIndex
CREATE INDEX "SignalLog_grade_emittedAt_idx" ON "apex"."SignalLog"("grade", "emittedAt");

-- CreateIndex
CREATE INDEX "SignalLog_status_emittedAt_idx" ON "apex"."SignalLog"("status", "emittedAt");

-- CreateIndex
CREATE INDEX "SignalLog_emittedAt_idx" ON "apex"."SignalLog"("emittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorSettings_key_key" ON "apex"."OperatorSettings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MarketSnapshot_snapshot_id_key" ON "apex"."MarketSnapshot"("snapshot_id");

-- CreateIndex
CREATE INDEX "MarketSnapshot_cycle_id_symbol_idx" ON "apex"."MarketSnapshot"("cycle_id", "symbol");

-- CreateIndex
CREATE INDEX "MarketSnapshot_symbol_timestamp_idx" ON "apex"."MarketSnapshot"("symbol", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "TradeCandidate_candidate_id_key" ON "apex"."TradeCandidate"("candidate_id");

-- CreateIndex
CREATE INDEX "TradeCandidate_cycle_id_symbol_idx" ON "apex"."TradeCandidate"("cycle_id", "symbol");

-- CreateIndex
CREATE INDEX "TradeCandidate_snapshot_id_idx" ON "apex"."TradeCandidate"("snapshot_id");

-- CreateIndex
CREATE UNIQUE INDEX "RiskEvaluatedCandidate_candidate_id_key" ON "apex"."RiskEvaluatedCandidate"("candidate_id");

-- CreateIndex
CREATE INDEX "RiskEvaluatedCandidate_cycle_id_decision_idx" ON "apex"."RiskEvaluatedCandidate"("cycle_id", "decision");

-- CreateIndex
CREATE INDEX "RiskShadowLog_cycleId_idx" ON "apex"."RiskShadowLog"("cycleId");

-- CreateIndex
CREATE INDEX "RiskShadowLog_symbol_recordedAt_idx" ON "apex"."RiskShadowLog"("symbol", "recordedAt");

-- CreateIndex
CREATE INDEX "RiskShadowLog_matched_recordedAt_idx" ON "apex"."RiskShadowLog"("matched", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutableSignal_signal_id_key" ON "apex"."ExecutableSignal"("signal_id");

-- CreateIndex
CREATE INDEX "ExecutableSignal_cycle_id_symbol_idx" ON "apex"."ExecutableSignal"("cycle_id", "symbol");

-- CreateIndex
CREATE INDEX "ExecutableSignal_candidate_id_idx" ON "apex"."ExecutableSignal"("candidate_id");

-- CreateIndex
CREATE INDEX "SignalLifecycle_signal_id_updated_at_idx" ON "apex"."SignalLifecycle"("signal_id", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "SignalViewModel_view_id_key" ON "apex"."SignalViewModel"("view_id");

-- CreateIndex
CREATE INDEX "SignalViewModel_entity_ref_generated_at_idx" ON "apex"."SignalViewModel"("entity_ref", "generated_at");

-- CreateIndex
CREATE INDEX "SignalViewModel_display_type_generated_at_idx" ON "apex"."SignalViewModel"("display_type", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "CycleOutput_cycle_id_key" ON "apex"."CycleOutput"("cycle_id");

-- CreateIndex
CREATE INDEX "CycleOutput_started_at_idx" ON "apex"."CycleOutput"("started_at");

-- CreateIndex
CREATE INDEX "CycleOutput_pipeline_status_started_at_idx" ON "apex"."CycleOutput"("pipeline_status", "started_at");

-- AddForeignKey
ALTER TABLE "apex"."TradeLog" ADD CONSTRAINT "TradeLog_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "apex"."Setup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apex"."Signal" ADD CONSTRAINT "Signal_runId_fkey" FOREIGN KEY ("runId") REFERENCES "apex"."SignalRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apex"."DailySignalDelivery" ADD CONSTRAINT "DailySignalDelivery_dailySignalRunId_fkey" FOREIGN KEY ("dailySignalRunId") REFERENCES "apex"."DailySignalRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apex"."TradePlan" ADD CONSTRAINT "TradePlan_runId_fkey" FOREIGN KEY ("runId") REFERENCES "apex"."SignalRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apex"."TradePlan" ADD CONSTRAINT "TradePlan_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "apex"."Signal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apex"."Alert" ADD CONSTRAINT "Alert_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "apex"."Signal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
