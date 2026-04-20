import { TelegramNotifier } from "@/src/lib/telegram";
import { SCALP_ASSETS, scalpAssetConfig, type ScalpAssetId } from "@/src/scalp/data/fetchers/scalpAssetConfig";
import { fetchMultiTimeframe } from "@/src/scalp/data/fetchers/multiTimeframeFetcher";
import { getCurrentSession } from "@/src/scalp/data/fetchers/sessionDetector";
import {
  calculateScalpStats,
  createScalpDiagnostic,
  createScalpSignal,
  findExistingActiveScalpSignal,
  listActiveScalpForLifecycle,
  updateScalpAssetState,
  updateScalpSignalStatus,
  type ScalpSignalRow,
} from "@/src/scalp/api/scalpSignals";
import { checkTrendAlignment } from "@/src/scalp/engine/gates/gate1_trend";
import { checkKeyLevel } from "@/src/scalp/engine/gates/gate2_level";
import { checkMomentum } from "@/src/scalp/engine/gates/gate3_momentum";
import { checkCandlePattern } from "@/src/scalp/engine/gates/gate4_candle";
import { checkContext } from "@/src/scalp/engine/gates/gate5_context";
import { calculateATR } from "@/src/scalp/engine/gates/indicators";
import { scoreScalpSignal } from "@/src/scalp/engine/scoring/scalpScorer";
import { buildScalpTrade } from "@/src/scalp/engine/tradeBuilder/scalpTradeBuilder";
import type { Session } from "@/src/scalp/types/scalpTypes";

const DIAGNOSTIC_MODE = process.env.SCALP_DIAGNOSTIC_MODE === "true";
const MIN_SCORE = DIAGNOSTIC_MODE ? 40 : 60;
export const SCALP_ENGINE_VERSION = "SCALP_V3_5GATE";

type GateStatus = {
  pass: boolean;
  score: number;
  reasoning: string;
};

type RejectedGate = "gate1" | "gate2" | "gate3" | "gate4" | "gate5";

export interface GateResult {
  assetId: string;
  direction: "long" | "short";
  gate1: GateStatus;
  gate2: GateStatus;
  gate3: GateStatus;
  gate4: GateStatus;
  gate5: GateStatus;
  totalScore: number;
  passedAll: boolean;
  rejectedAt: RejectedGate | null;
}

type ScalpCycleResult = {
  skipped: boolean;
  session: Session;
  cycleId: string;
  engine: string;
  assetsScanned: number;
  assetsWithData: number;
  signals: Array<{ id: string; assetId: string; direction: string; score: number }>;
  gateResults: GateResult[];
  errors: string[];
  latency: number;
  stats?: Awaited<ReturnType<typeof calculateScalpStats>>;
};

const scalpTelegram = new TelegramNotifier();

function blankGate(reasoning = "Not reached"): GateStatus {
  return { pass: false, score: 0, reasoning };
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(6);
}

function formatScalpTelegram(signal: ScalpSignalRow): string {
  const grade = signal.score >= 75 ? "EXECUTABLE" : signal.score >= 60 ? "WATCHLIST" : "SKIP";
  return [
    "APEX SCALP SIGNAL",
    `${signal.assetId} | ${signal.direction.toUpperCase()} | ${grade}`,
    `Setup: ${signal.setupType}`,
    `Score: ${signal.score}/100`,
    `Gates: T${signal.gate1Trend} L${signal.gate2Level} M${signal.gate3Momentum} C${signal.gate4Candle} X${signal.gate5Context}`,
    `Entry: ${formatPrice(signal.entryPrice)}`,
    `Stop: ${formatPrice(signal.stopLoss)}`,
    `TP1: ${formatPrice(signal.tp1)} | TP2: ${formatPrice(signal.tp2)}`,
    `Level: ${signal.keyLevelType} @ ${formatPrice(signal.keyLevelPrice)}`,
    `Session: ${signal.session}`,
    `Time: ${signal.createdAt.toISOString()}`,
  ].join("\n");
}

async function sendScalpTelegram(signal: ScalpSignalRow): Promise<void> {
  if (!scalpTelegram.isConfigured()) return;
  const sent = await scalpTelegram.sendMessage(formatScalpTelegram(signal), {
    signalId: signal.id,
    messageType: "scalp_signal",
  });

  if (!sent) {
    console.warn(`[scalp] Telegram send failed for signal ${signal.id}`);
  }
}

function gateReason(result: GateResult, gate: RejectedGate): string {
  switch (gate) {
    case "gate1": return result.gate1.reasoning;
    case "gate2": return result.gate2.reasoning;
    case "gate3": return result.gate3.reasoning;
    case "gate4": return result.gate4.reasoning;
    case "gate5": return result.gate5.reasoning;
  }
}

function logGateResult(result: GateResult): void {
  if (!DIAGNOSTIC_MODE) return;

  const status = result.passedAll ? "PASS_ALL" : `REJECT_${result.rejectedAt ?? "unknown"}`;
  console.log(
    `[scalp][diag] ${result.assetId} ${result.direction.toUpperCase()} ${status} ` +
    `| g1=${result.gate1.score}:${result.gate1.pass ? "Y" : "N"} ` +
    `g2=${result.gate2.score}:${result.gate2.pass ? "Y" : "N"} ` +
    `g3=${result.gate3.score}:${result.gate3.pass ? "Y" : "N"} ` +
    `g4=${result.gate4.score}:${result.gate4.pass ? "Y" : "N"} ` +
    `g5=${result.gate5.score}:${result.gate5.pass ? "Y" : "N"} ` +
    `| total=${result.totalScore}`,
  );
}

function percent(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

function printDiagnosticSummary(
  results: GateResult[],
  signals: Array<{ id: string; assetId: string; direction: string; score: number }>,
  errors: string[],
  latencyMs: number,
): void {
  const totalEvaluations = results.length;
  const rejectionByGate = {
    gate1: results.filter(row => row.rejectedAt === "gate1").length,
    gate2: results.filter(row => row.rejectedAt === "gate2").length,
    gate3: results.filter(row => row.rejectedAt === "gate3").length,
    gate4: results.filter(row => row.rejectedAt === "gate4").length,
    gate5: results.filter(row => row.rejectedAt === "gate5").length,
  };

  const passedAll = results.filter(row => row.passedAll).length;
  const belowMin = results.filter(row => row.passedAll && row.totalScore < MIN_SCORE).length;

  console.log("\n" + "-".repeat(60));
  console.log("CYCLE DIAGNOSTIC REPORT");
  console.log("-".repeat(60));
  console.log(`Latency:              ${latencyMs}ms`);
  console.log(`Total evaluations:    ${totalEvaluations}`);
  console.log(`Signals generated:    ${signals.length}`);
  console.log(`Errors:               ${errors.length}`);
  console.log("");
  console.log("GATE FUNNEL:");
  console.log(`  Gate 1 (Trend):     ${rejectionByGate.gate1} rejected (${percent(rejectionByGate.gate1, totalEvaluations)})`);
  console.log(`  Gate 2 (Level):     ${rejectionByGate.gate2} rejected (${percent(rejectionByGate.gate2, totalEvaluations)})`);
  console.log(`  Gate 3 (Momentum):  ${rejectionByGate.gate3} rejected (${percent(rejectionByGate.gate3, totalEvaluations)})`);
  console.log(`  Gate 4 (Candle):    ${rejectionByGate.gate4} rejected (${percent(rejectionByGate.gate4, totalEvaluations)})`);
  console.log(`  Gate 5 (Context):   ${rejectionByGate.gate5} rejected (${percent(rejectionByGate.gate5, totalEvaluations)})`);
  console.log(`  Passed all 5:       ${passedAll} (${percent(passedAll, totalEvaluations)})`);
  console.log(`  Below min score:    ${belowMin} (${percent(belowMin, totalEvaluations)})`);
  console.log("-".repeat(60));

  const topMissed = results
    .filter(row => !row.passedAll && row.rejectedAt !== null)
    .map(row => ({
      ...row,
      nearScore: row.gate1.score + row.gate2.score + row.gate3.score + row.gate4.score + row.gate5.score,
    }))
    .sort((left, right) => right.nearScore - left.nearScore)
    .slice(0, 5);

  if (topMissed.length > 0) {
    console.log("\nCLOSEST MISSES (top 5):");
    for (const row of topMissed) {
      const rejectedAt = row.rejectedAt as RejectedGate;
      console.log(`  ${row.assetId} ${row.direction} - ${row.nearScore} pts, rejected at ${rejectedAt}`);
      console.log(`    ${rejectedAt}: ${gateReason(row, rejectedAt)}`);
    }
    console.log("");
  }
}

async function persistDiagnosticReport(
  cycleId: string,
  results: GateResult[],
  signals: Array<{ id: string; assetId: string; direction: string; score: number }>,
): Promise<void> {
  const rejectionByGate = {
    gate1: results.filter(row => row.rejectedAt === "gate1").length,
    gate2: results.filter(row => row.rejectedAt === "gate2").length,
    gate3: results.filter(row => row.rejectedAt === "gate3").length,
    gate4: results.filter(row => row.rejectedAt === "gate4").length,
    gate5: results.filter(row => row.rejectedAt === "gate5").length,
  };

  try {
    await createScalpDiagnostic({
      cycleId,
      totalEvaluations: results.length,
      signalsGenerated: signals.length,
      rejectionByGate,
      gateResults: results,
    });
  } catch (error) {
    console.error("[scalp] Failed to persist diagnostic:", error);
  }
}

async function updateActiveSignals(): Promise<void> {
  const activeSignals = await listActiveScalpForLifecycle();

  for (const signal of activeSignals) {
    const config = scalpAssetConfig[signal.assetId as ScalpAssetId];
    if (!config) continue;

    try {
      const data = await fetchMultiTimeframe(config.symbol);
      const candles = data.candles15m;
      let hitTp1At = signal.hitTp1At;
      let closed = false;

      for (const candle of candles) {
        if (candle.timestamp.getTime() < signal.createdAt.getTime()) continue;

        if (signal.direction === "long") {
          if (!hitTp1At && candle.high >= signal.tp1) {
            hitTp1At = candle.timestamp;
            await updateScalpSignalStatus({
              id: signal.id,
              status: "HIT_TP1",
              hitTp1At,
            });
          }

          if (candle.low <= signal.stopLoss) {
            await updateScalpSignalStatus({
              id: signal.id,
              status: "HIT_SL",
              hitTp1At,
              closedAt: candle.timestamp,
              outcomePnl: hitTp1At ? signal.riskUsd * 0.5 : -signal.riskUsd,
            });
            closed = true;
            break;
          }

          if (candle.high >= signal.tp2) {
            await updateScalpSignalStatus({
              id: signal.id,
              status: "HIT_TP2",
              hitTp1At: hitTp1At ?? candle.timestamp,
              hitTp2At: candle.timestamp,
              closedAt: candle.timestamp,
              outcomePnl: signal.riskUsd * 1.5,
            });
            closed = true;
            break;
          }
        } else {
          if (!hitTp1At && candle.low <= signal.tp1) {
            hitTp1At = candle.timestamp;
            await updateScalpSignalStatus({
              id: signal.id,
              status: "HIT_TP1",
              hitTp1At,
            });
          }

          if (candle.high >= signal.stopLoss) {
            await updateScalpSignalStatus({
              id: signal.id,
              status: "HIT_SL",
              hitTp1At,
              closedAt: candle.timestamp,
              outcomePnl: hitTp1At ? signal.riskUsd * 0.5 : -signal.riskUsd,
            });
            closed = true;
            break;
          }

          if (candle.low <= signal.tp2) {
            await updateScalpSignalStatus({
              id: signal.id,
              status: "HIT_TP2",
              hitTp1At: hitTp1At ?? candle.timestamp,
              hitTp2At: candle.timestamp,
              closedAt: candle.timestamp,
              outcomePnl: signal.riskUsd * 1.5,
            });
            closed = true;
            break;
          }
        }
      }

      if (!closed) {
        const ageHours = (Date.now() - signal.createdAt.getTime()) / (1000 * 60 * 60);
        if (ageHours > 8) {
          await updateScalpSignalStatus({
            id: signal.id,
            status: "EXPIRED",
            hitTp1At,
            closedAt: new Date(),
            outcomePnl: hitTp1At ? signal.riskUsd * 0.5 : 0,
          });
        }
      }
    } catch (error) {
      console.error(`[scalp] lifecycle update failed for ${signal.id}:`, error);
    }
  }
}

export async function runScalpCycle(): Promise<ScalpCycleResult> {
  const startTime = Date.now();
  const currentSession = getCurrentSession();
  const cycleId = `scalp-${Date.now()}`;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[scalp] Cycle ${cycleId} - Session: ${currentSession} - Mode: ${DIAGNOSTIC_MODE ? "DIAGNOSTIC" : "PRODUCTION"}`);
  console.log(`${"=".repeat(60)}`);

  if (currentSession === "off") {
    console.log("[scalp] Off-hours, skipping cycle");
    return {
      skipped: true,
      session: currentSession,
      cycleId,
      engine: SCALP_ENGINE_VERSION,
      assetsScanned: 0,
      assetsWithData: 0,
      signals: [],
      gateResults: [],
      errors: [],
      latency: Date.now() - startTime,
      stats: await calculateScalpStats().catch(() => undefined),
    };
  }

  const signals: Array<{ id: string; assetId: string; direction: string; score: number }> = [];
  const gateResults: GateResult[] = [];
  const errors: string[] = [];
  let assetsScanned = 0;
  let assetsWithData = 0;

  for (const assetId of SCALP_ASSETS) {
    assetsScanned += 1;
    const config = scalpAssetConfig[assetId];

    try {
      const data = await fetchMultiTimeframe(config.symbol);
      const { candles15m, candles1h, candles4h, candlesDaily } = data;

      if (!data || candles15m.length < 50 || candles1h.length < 50 || candlesDaily.length < 20) {
        console.log(`[scalp] ${assetId}: insufficient data, skipping`);
        await updateScalpAssetState({
          assetId,
          lastScanned: new Date(),
          lastPrice: candles15m.at(-1)?.close ?? 0,
          hasActiveSignal: false,
          trend1h: null,
          trend4h: null,
          currentSession,
          atrPct: null,
        });
        continue;
      }
      assetsWithData += 1;

      const currentPrice = candles15m[candles15m.length - 1].close;
      const trendGate = checkTrendAlignment(candles1h, candles4h);
      let hasSignalForAsset = false;

      for (const direction of ["long", "short"] as const) {
        const result: GateResult = {
          assetId,
          direction,
          gate1: blankGate(),
          gate2: blankGate(),
          gate3: blankGate(),
          gate4: blankGate(),
          gate5: blankGate(),
          totalScore: 0,
          passedAll: false,
          rejectedAt: null,
        };

        result.gate1 = {
          pass: trendGate.pass && trendGate.alignedDirection === direction,
          score: trendGate.score,
          reasoning: trendGate.alignedDirection === direction
            ? trendGate.reasoning
            : `${trendGate.reasoning}; direction mismatch for ${direction}`,
        };

        if (!result.gate1.pass) {
          result.rejectedAt = "gate1";
          logGateResult(result);
          gateResults.push(result);
          continue;
        }

        const gate2 = checkKeyLevel(direction, currentPrice, candles15m, candles1h, candlesDaily, config.pipSize);
        result.gate2 = { pass: gate2.pass, score: gate2.score, reasoning: gate2.reasoning };

        if (!gate2.pass || typeof gate2.levelPrice !== "number" || !gate2.levelType) {
          result.rejectedAt = "gate2";
          logGateResult(result);
          gateResults.push(result);
          continue;
        }

        const gate3 = checkMomentum(direction, candles15m);
        result.gate3 = { pass: gate3.pass, score: gate3.score, reasoning: gate3.reasoning };

        if (!gate3.pass) {
          result.rejectedAt = "gate3";
          logGateResult(result);
          gateResults.push(result);
          continue;
        }

        const gate4 = checkCandlePattern(direction, candles15m);
        result.gate4 = { pass: gate4.pass, score: gate4.score, reasoning: gate4.reasoning };

        if (!gate4.pass) {
          result.rejectedAt = "gate4";
          logGateResult(result);
          gateResults.push(result);
          continue;
        }

        const gate5 = checkContext(candles15m, config.preferredSessions, data.upcomingNews);
        result.gate5 = { pass: gate5.pass, score: gate5.score, reasoning: gate5.reasoning };

        if (!gate5.pass) {
          result.rejectedAt = "gate5";
          logGateResult(result);
          gateResults.push(result);
          continue;
        }

        const totalScore = scoreScalpSignal({
          gate1Trend: trendGate.score,
          gate2Level: gate2.score,
          gate3Momentum: gate3.score,
          gate4Candle: gate4.score,
          gate5Context: gate5.score,
        });

        result.totalScore = totalScore;
        result.passedAll = true;
        logGateResult(result);
        gateResults.push(result);

        if (totalScore < MIN_SCORE) {
          console.log(`[scalp] ${assetId} ${direction}: passed all gates but score ${totalScore} < ${MIN_SCORE}`);
          continue;
        }

        const trade = buildScalpTrade({
          direction,
          entryPrice: currentPrice,
          candles15m,
          keyLevelPrice: gate2.levelPrice,
          pipSize: config.pipSize,
          riskUsd: 200,
        });

        if (!trade) {
          console.log(`[scalp] ${assetId} ${direction}: trade build failed (SL too wide)`);
          continue;
        }

        const setupType = `confluence_${direction}`;
        const existing = await findExistingActiveScalpSignal(assetId, direction, setupType);
        if (existing) {
          continue;
        }

        const row = await createScalpSignal({
          assetId,
          symbol: config.symbol,
          direction,
          setupType,
          score: totalScore,
          gate1Trend: trendGate.score,
          gate2Level: gate2.score,
          gate3Momentum: gate3.score,
          gate4Candle: gate4.score,
          gate5Context: gate5.score,
          trendAligned: true,
          atKeyLevel: true,
          momentumOk: true,
          candleConfirmed: true,
          contextClear: true,
          entryPrice: trade.entry,
          stopLoss: trade.sl,
          tp1: trade.tp1,
          tp2: trade.tp2,
          positionSize: trade.positionSize,
          riskUsd: trade.riskUsd,
          session: currentSession,
          atrPct: gate5.atrPct,
          keyLevelType: gate2.levelType,
          keyLevelPrice: gate2.levelPrice,
          description: `5-gate ${direction.toUpperCase()} on ${assetId} at ${gate2.levelType}`,
          reasoning: {
            gate1: trendGate.reasoning,
            gate2: gate2.reasoning,
            gate3: gate3.reasoning,
            gate4: gate4.reasoning,
            gate5: gate5.reasoning,
          },
          status: "ACTIVE",
        });

        signals.push({ id: row.id, assetId: row.assetId, direction: row.direction, score: row.score });
        hasSignalForAsset = true;

        await sendScalpTelegram(row).catch((error) => {
          console.warn(`[scalp] Telegram error for ${row.id}:`, error);
        });

        console.log(`[scalp] ${assetId} ${direction.toUpperCase()} SIGNAL - score ${totalScore}/100`);
      }

      const atr14 = calculateATR(candles15m.slice(-30), 14);
      const atr20 = calculateATR(candles15m.slice(-35), 20);
      const atrPct = atr20 > 0 ? atr14 / atr20 : null;

      await updateScalpAssetState({
        assetId,
        lastScanned: new Date(),
        lastPrice: currentPrice,
        hasActiveSignal: hasSignalForAsset,
        trend1h: trendGate.trend1h,
        trend4h: trendGate.trend4h,
        currentSession,
        atrPct,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[scalp] ${assetId} error:`, error);
      errors.push(`${assetId}: ${message}`);
      await updateScalpAssetState({
        assetId,
        lastScanned: new Date(),
        lastPrice: 0,
        hasActiveSignal: false,
        trend1h: null,
        trend4h: null,
        currentSession,
        atrPct: null,
      });
    }
  }

  printDiagnosticSummary(gateResults, signals, errors, Date.now() - startTime);
  await persistDiagnosticReport(cycleId, gateResults, signals);
  await updateActiveSignals();

  return {
    skipped: false,
    cycleId,
    engine: SCALP_ENGINE_VERSION,
    assetsScanned,
    assetsWithData,
    signals,
    gateResults,
    errors,
    session: currentSession,
    latency: Date.now() - startTime,
    stats: await calculateScalpStats().catch(() => undefined),
  };
}
