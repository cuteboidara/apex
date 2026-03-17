-- CreateTable
CREATE TABLE "Setup" (
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
CREATE TABLE "TradeLog" (
    "id" TEXT NOT NULL,
    "setupId" TEXT NOT NULL,
    "entry" DOUBLE PRECISION,
    "exit" DOUBLE PRECISION,
    "pnl" DOUBLE PRECISION,
    "notes" TEXT,
    "outcome" TEXT,

    CONSTRAINT "TradeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeLog_setupId_key" ON "TradeLog"("setupId");

-- AddForeignKey
ALTER TABLE "TradeLog" ADD CONSTRAINT "TradeLog_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "Setup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
