-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL,
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

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramSettings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "minRank" TEXT NOT NULL DEFAULT 'A',
    "allowedAssets" TEXT NOT NULL DEFAULT 'ALL',
    "weekendCryptoOnly" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramSettings_pkey" PRIMARY KEY ("id")
);
