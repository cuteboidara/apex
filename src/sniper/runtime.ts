import { SNIPER_ASSETS, sniperAssetConfig, type SniperAssetId } from "@/src/sniper/data/fetchers/assetConfig";
import { fetchCandles } from "@/src/sniper/data/fetchers/yahoo15m";
import { getCurrentSession } from "@/src/sniper/data/fetchers/sessionDetector";
import { detectLiquiditySweepSetups } from "@/src/sniper/engine/setups/liquiditySweepSetup";
import { detectBOSContinuationSetups } from "@/src/sniper/engine/setups/bosContinuationSetup";
import {
  calculateSniperStats,
  createSniperSignal,
  findExistingActiveSignal,
  listActiveForLifecycleChecks,
  markSignalOutcome,
  updateSniperAssetState,
  type SniperSignalRow,
} from "@/src/sniper/api/sniperSignals";
import { TelegramNotifier } from "@/src/lib/telegram";

import type { Session, SniperSetup } from "@/src/sniper/types/sniperTypes";

type SniperCycleResult = {
  skipped: boolean;
  session: Session;
  signals: Array<{ id: string; assetId: string; setupType: string; score: number }>;
  errors: string[];
  latencyMs: number;
  stats?: Awaited<ReturnType<typeof calculateSniperStats>>;
};

const sniperTelegram = new TelegramNotifier();

function formatSniperPrice(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function formatSniperTelegramSignal(signal: SniperSignalRow): string {
  const direction = signal.direction.toUpperCase();
  const scoreLabel = signal.score >= 70 ? "EXECUTABLE" : signal.score >= 50 ? "WATCHLIST" : "LOW";

  return [
    "APEX SNIPER SIGNAL",
    `${signal.assetId} | ${direction} | ${scoreLabel}`,
    `Setup: ${signal.setupType}`,
    `Score: ${signal.score}/100`,
    `Entry: ${formatSniperPrice(signal.entryPrice)}`,
    `Stop: ${formatSniperPrice(signal.stopLoss)}`,
    `Target: ${formatSniperPrice(signal.takeProfit)}`,
    `R:R ${signal.riskReward.toFixed(2)}:1`,
    `Session: ${signal.sessionName}`,
    `Timeframe: ${signal.timeframe}`,
    `Time: ${signal.createdAt.toISOString()}`,
  ].join("\n");
}

async function sendSniperSignalTelegram(signal: SniperSignalRow): Promise<void> {
  if (!sniperTelegram.isConfigured()) {
    return;
  }

  const sent = await sniperTelegram.sendMessage(
    formatSniperTelegramSignal(signal),
    {
      signalId: signal.id,
      messageType: "sniper_signal",
    },
  );

  if (!sent) {
    console.warn(`[sniper] Telegram send failed for signal ${signal.id}`);
  }
}

function roundLot(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

function pipValueByAsset(assetId: SniperAssetId): number {
  const category = sniperAssetConfig[assetId].category;
  if (category === "FX") return 10;
  if (category === "INDEX") return 1;
  return 10;
}

function calculatePositionSize(assetId: SniperAssetId, setup: SniperSetup, riskUsd: number): number {
  const riskDistance = Math.abs(setup.entryPrice - setup.stopLoss);
  if (riskDistance <= 0) return 0;
  return roundLot(riskUsd / (riskDistance * pipValueByAsset(assetId)));
}

async function updateActiveSignals(): Promise<void> {
  const activeSignals = await listActiveForLifecycleChecks();

  for (const signal of activeSignals) {
    const assetId = signal.assetId as SniperAssetId;
    const config = sniperAssetConfig[assetId];
    if (!config) continue;

    try {
      const since = new Date(Date.now() - (3 * 60 * 60 * 1000));
      const candles = await fetchCandles(config.symbol, since, new Date(), "15m");

      for (const candle of candles) {
        if (candle.timestamp.getTime() < signal.createdAt.getTime()) continue;

        if (signal.direction === "long") {
          if (candle.high >= signal.takeProfit) {
            await markSignalOutcome({
              id: signal.id,
              status: "HIT_TP",
              outcomePrice: signal.takeProfit,
              outcomePnl: signal.riskUsd * signal.riskReward,
              outcomeTime: candle.timestamp,
            });
            break;
          }
          if (candle.low <= signal.stopLoss) {
            await markSignalOutcome({
              id: signal.id,
              status: "HIT_SL",
              outcomePrice: signal.stopLoss,
              outcomePnl: -signal.riskUsd,
              outcomeTime: candle.timestamp,
            });
            break;
          }
        } else {
          if (candle.low <= signal.takeProfit) {
            await markSignalOutcome({
              id: signal.id,
              status: "HIT_TP",
              outcomePrice: signal.takeProfit,
              outcomePnl: signal.riskUsd * signal.riskReward,
              outcomeTime: candle.timestamp,
            });
            break;
          }
          if (candle.high >= signal.stopLoss) {
            await markSignalOutcome({
              id: signal.id,
              status: "HIT_SL",
              outcomePrice: signal.stopLoss,
              outcomePnl: -signal.riskUsd,
              outcomeTime: candle.timestamp,
            });
            break;
          }
        }
      }

      const ageHours = (Date.now() - signal.createdAt.getTime()) / (1000 * 60 * 60);
      if (ageHours > 48 && signal.status === "ACTIVE") {
        await markSignalOutcome({ id: signal.id, status: "EXPIRED" });
      }
    } catch (error) {
      console.error(`[sniper] lifecycle update failed for ${signal.id}:`, error);
    }
  }
}

function pickBestSetups(setups: SniperSetup[]): SniperSetup[] {
  const grouped = new Map<string, SniperSetup>();
  for (const setup of setups) {
    const prev = grouped.get(setup.assetId);
    if (!prev || setup.score > prev.score) {
      grouped.set(setup.assetId, setup);
    }
  }
  return [...grouped.values()].sort((a, b) => b.score - a.score);
}

export async function runSniperCycle(): Promise<SniperCycleResult> {
  const started = Date.now();
  const session = getCurrentSession();
  const errors: string[] = [];

  console.log(`[sniper] Starting cycle in session=${session}`);

  if (session === "off") {
    return {
      skipped: true,
      session,
      signals: [],
      errors: [],
      latencyMs: Date.now() - started,
      stats: await calculateSniperStats().catch(() => undefined),
    };
  }

  const created: Array<{ id: string; assetId: string; setupType: string; score: number }> = [];

  const assetResults = await Promise.allSettled(
    SNIPER_ASSETS.map(async (assetId) => {
      const config = sniperAssetConfig[assetId];
      const end = new Date();
      const start15m = new Date(end.getTime() - (24 * 60 * 60 * 1000));
      const start1h = new Date(end.getTime() - (7 * 24 * 60 * 60 * 1000));

      const [candles15m, candles1h] = await Promise.all([
        fetchCandles(config.symbol, start15m, end, "15m"),
        fetchCandles(config.symbol, start1h, end, "1h"),
      ]);

      return { assetId, config, candles15m, candles1h };
    }),
  );

  for (const assetResult of assetResults) {
    if (assetResult.status !== "fulfilled") {
      errors.push(String(assetResult.reason));
      continue;
    }

    const { assetId, config, candles15m, candles1h } = assetResult.value;

    try {
      if (candles15m.length === 0) {
        await updateSniperAssetState({
          assetId,
          lastScanned: new Date(),
          lastPrice: 0,
          hasActiveSignal: false,
          recentSweeps: [],
        });
        continue;
      }

      const sweepSetups = detectLiquiditySweepSetups(
        assetId,
        candles15m,
        candles1h,
        config.pipSize,
        config.preferredSessions,
      );
      const bosSetups = detectBOSContinuationSetups(
        assetId,
        candles15m,
        candles1h,
        config.pipSize,
        config.preferredSessions,
      );

      const setups = pickBestSetups([...sweepSetups, ...bosSetups]);

      await updateSniperAssetState({
        assetId,
        lastScanned: new Date(),
        lastPrice: candles15m.at(-1)?.close ?? 0,
        hasActiveSignal: setups.length > 0,
        recentSweeps: setups.slice(0, 3).map(setup => ({
          level: setup.sweepLevel,
          type: setup.direction,
          time: setup.sweepCandleTime.toISOString(),
        })),
      });

      for (const setup of setups) {
        const existing = await findExistingActiveSignal(setup.assetId, setup.sweepLevel);
        if (existing) continue;

        const riskUsd = 200;
        const positionSize = calculatePositionSize(assetId, setup, riskUsd);
        if (positionSize <= 0) continue;

        const row = await createSniperSignal({
          assetId: setup.assetId,
          symbol: config.symbol,
          setupType: setup.setupType,
          direction: setup.direction,
          score: setup.score,
          sweepQuality: setup.sweepQuality,
          rejection: setup.rejection,
          structure: setup.structure,
          sessionScore: setup.session,
          entryPrice: setup.entryPrice,
          stopLoss: setup.stopLoss,
          takeProfit: setup.takeProfit,
          riskReward: setup.riskReward,
          positionSize,
          riskUsd,
          sweepLevel: setup.sweepLevel,
          structureLevel: setup.structureLevel,
          sessionName: setup.currentSession,
          timeframe: "15m",
          status: "ACTIVE",
        });

        await sendSniperSignalTelegram(row).catch((telegramError) => {
          console.warn(`[sniper] Telegram error for ${row.id}:`, telegramError);
        });

        created.push({
          id: row.id,
          assetId: row.assetId,
          setupType: row.setupType,
          score: row.score,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${assetId}: ${message}`);
      console.error(`[sniper] asset ${assetId} failed:`, error);
    }
  }

  await updateActiveSignals();

  const latencyMs = Date.now() - started;
  console.log(`[sniper] Cycle complete: signals=${created.length} latency=${latencyMs}ms`);

  return {
    skipped: false,
    session,
    signals: created,
    errors,
    latencyMs,
    stats: await calculateSniperStats().catch(() => undefined),
  };
}
