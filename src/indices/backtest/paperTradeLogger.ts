// src/indices/backtest/paperTradeLogger.ts
// Log all signals generated during 14-day paper trading test

import fs from 'fs';
import path from 'path';
import type { AMTSignal } from '@/src/indices/types/amtTypes';

// ─── Types ─────────────────────────────────────────────────────────────────

interface LoggedSignal {
  cycleNumber: number;
  timestamp: string;
  asset: string;
  setupType: string;
  direction: 'long' | 'short';
  score: number;
  candleQuality: number;
  orderFlowConfidence: number;
  smcTaAlignment: number;
  macroAdjustment: number;
  entryZone: { high: number; low: number; mid: number };
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  riskRewardRatio: number;
  positionSize: number;
  riskAmount: number;
  newsRisk: string;
  setupDescription: string;
}

export interface PaperTradingStats {
  totalCycles: number;
  totalSignals: number;
  executableSignals: number;
  watchlistSignals: number;
  avgScore: number;
  signalsByAsset: Record<string, number>;
  signalsBySetup: Record<string, number>;
  signalsByDirection: Record<string, number>;
  highConfidenceSignals: number;  // >= 70
}

// ─── Logger class ──────────────────────────────────────────────────────────

export class PaperTradeLogger {
  private readonly logFile: string;
  private signals: LoggedSignal[] = [];
  private cycleCount = 0;

  constructor(testName = 'paper-trading') {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const logsDir = path.join(process.cwd(), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    this.logFile = path.join(logsDir, `${testName}-${ts}.json`);
    console.log(`[paper-logger] Log: ${this.logFile}`);
  }

  logCycle(cycleNumber: number, signals: AMTSignal[]): void {
    this.cycleCount = cycleNumber;

    for (const signal of signals) {
      const entry: LoggedSignal = {
        cycleNumber,
        timestamp: new Date().toISOString(),
        asset: signal.assetId,
        setupType: signal.setupType,
        direction: signal.direction,
        score: signal.totalScore,
        candleQuality: signal.candleQuality,
        orderFlowConfidence: signal.orderFlowConfidence,
        smcTaAlignment: signal.smcTaAlignment,
        macroAdjustment: signal.macroAdjustment,
        entryZone: signal.entryZone,
        stopLoss: signal.stopLoss,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        riskRewardRatio: signal.riskRewardRatio,
        positionSize: signal.positionSize,
        riskAmount: signal.riskAmount,
        newsRisk: signal.newsRisk,
        setupDescription: signal.setupDescription,
      };

      this.signals.push(entry);
    }

    this.flush();

    // Console summary
    console.log(`\n[Cycle ${cycleNumber}] ${signals.length} signal(s):`);
    for (const s of signals) {
      const icon = s.totalScore >= 70 ? '⚡' : s.totalScore >= 60 ? '✓' : '•';
      console.log(`  ${icon} ${s.assetId} ${s.direction.toUpperCase()} (${s.totalScore}/100) — ${s.setupType}`);
    }
  }

  getStats(): PaperTradingStats {
    const signalsByAsset: Record<string, number> = {};
    const signalsBySetup: Record<string, number> = {};
    const signalsByDirection: Record<string, number> = { long: 0, short: 0 };

    for (const s of this.signals) {
      signalsByAsset[s.asset] = (signalsByAsset[s.asset] ?? 0) + 1;
      signalsBySetup[s.setupType] = (signalsBySetup[s.setupType] ?? 0) + 1;
      signalsByDirection[s.direction]++;
    }

    return {
      totalCycles: this.cycleCount,
      totalSignals: this.signals.length,
      executableSignals: this.signals.filter(s => s.score >= 60).length,
      watchlistSignals: this.signals.filter(s => s.score >= 40 && s.score < 60).length,
      highConfidenceSignals: this.signals.filter(s => s.score >= 70).length,
      avgScore: this.signals.length > 0
        ? this.signals.reduce((acc, s) => acc + s.score, 0) / this.signals.length
        : 0,
      signalsByAsset,
      signalsBySetup,
      signalsByDirection,
    };
  }

  getLogPath(): string {
    return this.logFile;
  }

  printSummary(): void {
    const stats = this.getStats();
    console.log('\n=== PAPER TRADING SUMMARY ===');
    console.log(`Total cycles:              ${stats.totalCycles}`);
    console.log(`Total signals:             ${stats.totalSignals}`);
    console.log(`High confidence (≥70):     ${stats.highConfidenceSignals}`);
    console.log(`Executable (≥60):          ${stats.executableSignals}`);
    console.log(`Watchlist (40–59):         ${stats.watchlistSignals}`);
    console.log(`Avg score:                 ${stats.avgScore.toFixed(1)}`);
    console.log(`\nBy direction: LONG ${stats.signalsByDirection.long ?? 0} | SHORT ${stats.signalsByDirection.short ?? 0}`);
    console.log('\nBy asset:');
    for (const [asset, count] of Object.entries(stats.signalsByAsset)) {
      console.log(`  ${asset}: ${count}`);
    }
    console.log('\nBy setup type:');
    for (const [setup, count] of Object.entries(stats.signalsBySetup)) {
      console.log(`  ${setup}: ${count}`);
    }
    console.log(`\nLog: ${this.logFile}`);
  }

  private flush(): void {
    const stats = this.getStats();
    const output = {
      metadata: {
        testType: 'paper-trading',
        startTime: this.signals[0]?.timestamp ?? new Date().toISOString(),
        lastUpdate: new Date().toISOString(),
        totalCycles: stats.totalCycles,
      },
      summary: {
        totalSignals: stats.totalSignals,
        executableSignals: stats.executableSignals,
        watchlistSignals: stats.watchlistSignals,
        highConfidenceSignals: stats.highConfidenceSignals,
        avgScore: Number(stats.avgScore.toFixed(2)),
        signalsByAsset: stats.signalsByAsset,
        signalsBySetup: stats.signalsBySetup,
        signalsByDirection: stats.signalsByDirection,
      },
      signals: this.signals,
    };
    fs.writeFileSync(this.logFile, JSON.stringify(output, null, 2));
  }
}

// ─── Standalone analyzer ───────────────────────────────────────────────────

export function analyzePaperTradingLog(logPath: string): void {
  if (!fs.existsSync(logPath)) {
    console.error(`Log not found: ${logPath}`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(logPath, 'utf-8')) as {
    signals: LoggedSignal[];
    summary: PaperTradingStats;
  };

  const signals = data.signals;
  console.log('\n=== PAPER TRADING ANALYSIS ===');
  console.log(`Total signals: ${signals.length}`);
  console.log(`Avg score:     ${(signals.reduce((s, x) => s + x.score, 0) / (signals.length || 1)).toFixed(1)}`);
  console.log(`≥70:  ${signals.filter(s => s.score >= 70).length}`);
  console.log(`60–69: ${signals.filter(s => s.score >= 60 && s.score < 70).length}`);
  console.log(`40–59: ${signals.filter(s => s.score >= 40 && s.score < 60).length}`);

  console.log('\nLast 5 signals:');
  for (const s of signals.slice(-5)) {
    console.log(`  ${s.timestamp.slice(0, 16)} | ${s.asset} ${s.direction.toUpperCase()} | ${s.score}/100 | RR ${s.riskRewardRatio.toFixed(2)}`);
  }
}
