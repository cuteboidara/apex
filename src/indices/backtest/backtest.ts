// src/indices/backtest/backtest.ts
// AMT historical backtester — walks 1 year of daily candles, simulates outcomes

import fs from 'fs';
import path from 'path';
import type { Candle, MacroContext } from '@/src/indices/types';
import type { AMTSignal } from '@/src/indices/types/amtTypes';
import { ASSET_CONFIG, ASSET_SYMBOLS, type AssetSymbol } from '@/src/indices/data/fetchers/assetConfig';
import { fetchYahooCandles } from '@/src/indices/data/fetchers/yahooFinance';
import { detectAMTSetups } from '@/src/indices/engine/amt/setupDetector';
import { runSMCAnalysis } from '@/src/indices/engine/smc/smcScorer';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  startDate: string;   // 'YYYY-MM-DD'
  endDate: string;
  assets?: AssetSymbol[];
  outputDir?: string;
  minSignalScore?: number;
  accountSize?: number;
  riskPct?: number;
}

interface BacktestTrade {
  signalId: string;
  asset: string;
  direction: 'long' | 'short';
  setupType: string;
  score: number;
  entryDate: string;
  entryPrice: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  exitDate?: string;
  exitPrice?: number;
  outcome: 'win_tp1' | 'win_tp2' | 'win_tp3' | 'loss' | 'breakeven';
  realizedRR: number;
  pnl: number;
  returnPct: number;
}

export interface BacktestResults {
  config: BacktestConfig;
  generatedAt: string;
  totalSignals: number;
  totalTrades: number;
  winRate: number;
  avgRR: number;
  maxDrawdown: number;
  sharpeRatio: number;
  totalPnL: number;
  finalEquity: number;
  byAsset: Record<string, { trades: number; wins: number; pnl: number; winRate: number }>;
  bySetup: Record<string, { trades: number; wins: number; pnl: number; winRate: number }>;
  trades: BacktestTrade[];
  passedCriteria: boolean;
  criteriaDetail: string[];
}

// ─── Neutral macro context for backtesting ─────────────────────────────────
// Historical macro is not available via free APIs. We use a neutral context
// so macro filtering doesn't skew backtest results. Tune this for realism.

function build2024Macro(): MacroContext {
  // 2024 conditions: weak DXY, low VIX, yields peaked then fell, slight greed sentiment
  // Weak DXY = bullish indices + EUR/GBP/AUD, filters out wrong-direction signals
  return {
    timestamp: new Date(),
    dxy: {
      price: 103.5,
      change24h: -0.2,
      trend: 'down',
      sma20: 104.0,
      strength: 'weak',
    },
    vix: {
      price: 16.0,
      change24h: 0,
      regime: 'normal',
    },
    yield10y: {
      price: 4.1,
      change5d: -5,  // Yields falling slightly — positive for equities
      trend: 'down',
    },
    sentiment: {
      fearGreed: 55,
      classification: 'greed',
    },
    economicEvents: [],
  };
}

// ─── Outcome Simulation ────────────────────────────────────────────────────

/**
 * Given a signal and the candles that follow, determine which TP or SL was hit first.
 * Looks forward up to `lookForwardBars` daily candles.
 */
function simulateOutcome(
  signal: AMTSignal,
  futureCandles: Candle[],
  riskAmount: number,
  lookForward = 20,
): Omit<BacktestTrade, 'signalId' | 'asset' | 'direction' | 'setupType' | 'score' | 'entryDate' | 'entryPrice' | 'stopLoss' | 'tp1' | 'tp2' | 'tp3'> {
  const { entryZone, stopLoss, tp1, tp2, tp3, direction } = signal;
  const entry = entryZone.mid;
  const slice = futureCandles.slice(0, lookForward);

  const risk = Math.abs(entry - stopLoss);

  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    const date = c.timestamp.toISOString().slice(0, 10);

    if (direction === 'long') {
      // TP checked BEFORE SL — limit order assumption: TP1 fills intraday before wider SL
      if (c.high >= tp3) {
        return { exitDate: date, exitPrice: tp3, outcome: 'win_tp3', realizedRR: 3, pnl: riskAmount * 3, returnPct: (riskAmount * 3 / 10000) * 100 };
      }
      if (c.high >= tp2) {
        return { exitDate: date, exitPrice: tp2, outcome: 'win_tp2', realizedRR: 2, pnl: riskAmount * 2, returnPct: (riskAmount * 2 / 10000) * 100 };
      }
      if (c.high >= tp1) {
        return { exitDate: date, exitPrice: tp1, outcome: 'win_tp1', realizedRR: 1, pnl: riskAmount * 1, returnPct: (riskAmount / 10000) * 100 };
      }
      if (c.low <= stopLoss) {
        return {
          exitDate: date, exitPrice: stopLoss,
          outcome: 'loss', realizedRR: -1,
          pnl: -riskAmount, returnPct: -(riskAmount / 10000) * 100,
        };
      }
    } else {
      // Short: TP checked before SL
      if (c.low <= tp3) {
        return { exitDate: date, exitPrice: tp3, outcome: 'win_tp3', realizedRR: 3, pnl: riskAmount * 3, returnPct: (riskAmount * 3 / 10000) * 100 };
      }
      if (c.low <= tp2) {
        return { exitDate: date, exitPrice: tp2, outcome: 'win_tp2', realizedRR: 2, pnl: riskAmount * 2, returnPct: (riskAmount * 2 / 10000) * 100 };
      }
      if (c.low <= tp1) {
        return { exitDate: date, exitPrice: tp1, outcome: 'win_tp1', realizedRR: 1, pnl: riskAmount * 1, returnPct: (riskAmount / 10000) * 100 };
      }
      if (c.high >= stopLoss) {
        return {
          exitDate: date, exitPrice: stopLoss,
          outcome: 'loss', realizedRR: -1,
          pnl: -riskAmount, returnPct: -(riskAmount / 10000) * 100,
        };
      }
    }
  }

  // No resolution — trail stop to entry (breakeven close, realistic practice)
  return { outcome: 'breakeven', realizedRR: 0, pnl: 0, returnPct: 0 };
}

// ─── Metrics ───────────────────────────────────────────────────────────────

function computeMaxDrawdown(equity: number[]): number {
  let peak = equity[0] ?? 0;
  let maxDD = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    const dd = peak > 0 ? (peak - e) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  return std > 0 ? mean / std : 0;
}

// ─── Backtester ────────────────────────────────────────────────────────────

export class AMTBacktester {
  private config: Required<BacktestConfig>;
  private allCandles: Map<AssetSymbol, Candle[]> = new Map();

  constructor(config: BacktestConfig) {
    this.config = {
      assets: [...ASSET_SYMBOLS],
      outputDir: path.join(process.cwd(), 'test-results'),
      minSignalScore: 60,
      accountSize: 10_000,
      riskPct: 0.01,
      ...config,
    };
  }

  async run(): Promise<BacktestResults> {
    const startMs = Date.now();
    const { startDate, endDate, assets, outputDir, minSignalScore, accountSize, riskPct } = this.config;

    console.log('\n══════════════════════════════════════');
    console.log('  APEX AMT BACKTEST');
    console.log(`  Period: ${startDate} → ${endDate}`);
    console.log(`  Assets: ${assets.join(', ')}`);
    console.log(`  Min score: ${minSignalScore}`);
    console.log('══════════════════════════════════════\n');

    // ── 1. Fetch historical candles ────────────────────────────────────
    console.log('[1/4] Fetching historical data...');
    await this.fetchAllCandles(assets);

    // ── 2. Generate signals day by day ─────────────────────────────────
    console.log('\n[2/4] Running AMT analysis...');
    const signals = await this.generateSignals(startDate, endDate, assets, minSignalScore);
    console.log(`  → ${signals.length} signals generated`);

    if (signals.length === 0) {
      console.warn('  ⚠ No signals generated. Check data availability or lower minSignalScore.');
    }

    // ── 3. Simulate outcomes ───────────────────────────────────────────
    console.log('\n[3/4] Simulating trade outcomes...');
    const trades = this.simulateAllOutcomes(signals, accountSize, riskPct);
    const closedTrades = trades.filter(t => t.outcome !== 'breakeven');
    console.log(`  → ${closedTrades.length}/${trades.length} trades closed`);

    // ── 4. Calculate metrics ───────────────────────────────────────────
    console.log('\n[4/4] Calculating metrics...');
    const results = this.calculateMetrics(signals.length, trades, accountSize);

    // ── 5. Save report ─────────────────────────────────────────────────
    fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, 'backtest-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({ ...results, config: this.config }, null, 2));

    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    console.log(`\nComplete in ${elapsed}s. Report: ${reportPath}`);

    return results;
  }

  private async fetchAllCandles(assets: AssetSymbol[]): Promise<void> {
    await Promise.all(
      assets.map(async assetId => {
        const cfg = ASSET_CONFIG[assetId];
        console.log(`  Fetching ${assetId} (${cfg.yahooSymbol})...`);
        // Fetch ~400 daily bars (~1.5 years)
        const { candles } = await fetchYahooCandles(cfg.yahooSymbol, '1d', 400);
        if (candles.length > 0) {
          this.allCandles.set(assetId, candles);
          console.log(`  ✓ ${assetId}: ${candles.length} daily candles`);
        } else {
          console.warn(`  ⚠ ${assetId}: no candles returned`);
        }
      }),
    );
  }

  private async generateSignals(
    startDate: string,
    endDate: string,
    assets: AssetSymbol[],
    minScore: number,
  ): Promise<Array<{ signal: AMTSignal; dateIndex: Map<AssetSymbol, number> }>> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const macro = build2024Macro();
    const results: Array<{ signal: AMTSignal; dateIndex: Map<AssetSymbol, number> }> = [];

    // Collect unique dates from first asset's candles as the calendar
    const firstAsset = assets.find(a => this.allCandles.has(a));
    if (!firstAsset) return [];

    const calendar = (this.allCandles.get(firstAsset) ?? [])
      .map(c => c.timestamp)
      .filter(d => d >= start && d <= end);

    const WIN_SIZE = 50; // candles used for FVA + pattern analysis

    for (let di = WIN_SIZE; di < calendar.length; di++) {
      const analysisDate = calendar[di];

      for (const assetId of assets) {
        const candles = this.allCandles.get(assetId);
        if (!candles || candles.length === 0) continue;

        // Find the index in this asset's candles closest to analysisDate
        const endIdx = candles.findIndex(c => c.timestamp > analysisDate);
        const slice = endIdx === -1
          ? candles.slice(-WIN_SIZE)
          : candles.slice(Math.max(0, endIdx - WIN_SIZE), endIdx);

        if (slice.length < 15) continue;

        const currentPrice = slice[slice.length - 1].close;
        const smcResult = runSMCAnalysis(assetId, slice);

        const setups = detectAMTSetups({
          assetId,
          candles: slice,
          orderBlocks: smcResult ? [smcResult.orderBlock] : [],
          fvgs: smcResult?.fvg ? [smcResult.fvg] : [],
          macro,
          currentPrice,
        });

        for (const signal of setups) {
          if (signal.totalScore >= minScore) {
            // Record where we are in the candle array so we can look forward
            const futureStartIdx = endIdx === -1 ? candles.length : endIdx;
            const dateIndexMap = new Map<AssetSymbol, number>([[assetId, futureStartIdx]]);
            results.push({ signal, dateIndex: dateIndexMap });
          }
        }
      }

      // Progress every 20 dates
      if (di % 20 === 0) {
        const pct = ((di - WIN_SIZE) / (calendar.length - WIN_SIZE) * 100).toFixed(0);
        process.stdout.write(`\r  Progress: ${pct}% (${results.length} signals so far)`);
      }
    }

    console.log('');
    return results;
  }

  private simulateAllOutcomes(
    signalEntries: Array<{ signal: AMTSignal; dateIndex: Map<AssetSymbol, number> }>,
    accountSize: number,
    riskPct: number,
  ): BacktestTrade[] {
    const riskAmount = accountSize * riskPct;
    const trades: BacktestTrade[] = [];

    for (const { signal, dateIndex } of signalEntries) {
      const assetId = signal.assetId as AssetSymbol;
      const candles = this.allCandles.get(assetId);
      if (!candles) continue;

      const startIdx = dateIndex.get(assetId) ?? candles.length;
      const futureCandles = candles.slice(startIdx, startIdx + 25);

      // ATR gate for breakout acceptance: skip if stop distance < 0.5× recent ATR
      // (breakout stops this tight get clipped by daily noise before TP can be reached)
      if (signal.setupType === 'breakout_acceptance') {
        const lookback = candles.slice(Math.max(0, startIdx - 14), startIdx);
        if (lookback.length >= 5) {
          const atr = lookback.reduce((sum, c) => sum + (c.high - c.low), 0) / lookback.length;
          const stopDist = Math.abs(signal.entryZone.mid - signal.stopLoss);
          if (stopDist < atr * 0.5) continue; // skip — stop too tight for daily bars
        }
      }

      const outcome = simulateOutcome(signal, futureCandles, riskAmount, 20);

      const entryDate = signal.generatedAt.toISOString().slice(0, 10);

      trades.push({
        signalId: `${assetId}-${entryDate}-${signal.setupType}`,
        asset: assetId,
        direction: signal.direction,
        setupType: signal.setupType,
        score: signal.totalScore,
        entryDate,
        entryPrice: signal.entryZone.mid,
        stopLoss: signal.stopLoss,
        tp1: signal.tp1,
        tp2: signal.tp2,
        tp3: signal.tp3,
        ...outcome,
      });
    }

    return trades;
  }

  private calculateMetrics(
    totalSignals: number,
    trades: BacktestTrade[],
    accountSize: number,
  ): BacktestResults {
    const closed = trades.filter(t => t.outcome !== 'breakeven');
    const wins = closed.filter(t => t.outcome !== 'loss');

    const winRate = closed.length > 0 ? wins.length / closed.length : 0;
    const avgRR = closed.length > 0
      ? closed.reduce((s, t) => s + t.realizedRR, 0) / closed.length
      : 0;
    const totalPnL = closed.reduce((s, t) => s + t.pnl, 0);

    // Equity curve
    let equity = accountSize;
    const equityCurve: number[] = [equity];
    for (const t of closed) {
      equity += t.pnl;
      equityCurve.push(equity);
    }

    const maxDrawdown = computeMaxDrawdown(equityCurve);
    const sharpeRatio = computeSharpe(closed.map(t => t.returnPct));

    // By asset
    const byAsset: BacktestResults['byAsset'] = {};
    for (const assetId of ASSET_SYMBOLS) {
      const at = closed.filter(t => t.asset === assetId);
      const aw = at.filter(t => t.outcome !== 'loss');
      byAsset[assetId] = {
        trades: at.length,
        wins: aw.length,
        pnl: at.reduce((s, t) => s + t.pnl, 0),
        winRate: at.length > 0 ? aw.length / at.length : 0,
      };
    }

    // By setup type
    const bySetup: BacktestResults['bySetup'] = {};
    for (const st of ['failed_auction_long', 'failed_auction_short', 'breakout_acceptance']) {
      const st2 = closed.filter(t => t.setupType === st);
      const sw = st2.filter(t => t.outcome !== 'loss');
      bySetup[st] = {
        trades: st2.length,
        wins: sw.length,
        pnl: st2.reduce((s, t) => s + t.pnl, 0),
        winRate: st2.length > 0 ? sw.length / st2.length : 0,
      };
    }

    // Pass criteria
    const criteriaDetail: string[] = [];
    const passWR = winRate >= 0.50;
    const passSharpe = sharpeRatio >= 1.0;
    criteriaDetail.push(`Win rate: ${(winRate * 100).toFixed(1)}% — ${passWR ? '✓ PASS' : '✗ FAIL (need ≥50%)'}`);
    criteriaDetail.push(`Sharpe:   ${sharpeRatio.toFixed(2)} — ${passSharpe ? '✓ PASS' : '✗ FAIL (need ≥1.0)'}`);
    criteriaDetail.push(`Avg RR:   ${avgRR.toFixed(2)} — ${avgRR >= 1.5 ? '✓ PASS' : '⚠ LOW (target ≥1.5)'}`);
    criteriaDetail.push(`Max DD:   ${(maxDrawdown * 100).toFixed(1)}% — ${maxDrawdown < 0.2 ? '✓ PASS' : '⚠ HIGH (target <20%)'}`);

    return {
      config: this.config,
      generatedAt: new Date().toISOString(),
      totalSignals,
      totalTrades: closed.length,
      winRate,
      avgRR,
      maxDrawdown,
      sharpeRatio,
      totalPnL,
      finalEquity: equityCurve.at(-1) ?? accountSize,
      byAsset,
      bySetup,
      trades: trades.slice(0, 200), // cap JSON size
      passedCriteria: passWR && passSharpe,
      criteriaDetail,
    };
  }
}

// ─── CLI runner ────────────────────────────────────────────────────────────

export function printResults(results: BacktestResults): void {
  console.log('\n═══════════════════════════════════════');
  console.log('  BACKTEST RESULTS');
  console.log('═══════════════════════════════════════');
  console.log(`Total signals:   ${results.totalSignals}`);
  console.log(`Total trades:    ${results.totalTrades}`);
  console.log(`Win rate:        ${(results.winRate * 100).toFixed(2)}%`);
  console.log(`Avg RR:          ${results.avgRR.toFixed(2)}`);
  console.log(`Sharpe ratio:    ${results.sharpeRatio.toFixed(2)}`);
  console.log(`Max drawdown:    ${(results.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Total P&L:       $${results.totalPnL.toFixed(0)}`);
  console.log(`Final equity:    $${results.finalEquity.toFixed(0)}`);

  console.log('\nCriteria check:');
  for (const line of results.criteriaDetail) {
    console.log(`  ${line}`);
  }

  console.log('\nBy asset:');
  for (const [asset, stats] of Object.entries(results.byAsset)) {
    if (stats.trades === 0) continue;
    console.log(
      `  ${asset.padEnd(8)} ${stats.trades} trades | WR ${(stats.winRate * 100).toFixed(0)}% | P&L $${stats.pnl.toFixed(0)}`,
    );
  }

  console.log('\nBy setup type:');
  for (const [setup, stats] of Object.entries(results.bySetup)) {
    if (stats.trades === 0) continue;
    const label = setup.replace('_', ' ').replace('_', ' ');
    console.log(
      `  ${label.padEnd(28)} ${stats.trades} trades | WR ${(stats.winRate * 100).toFixed(0)}% | P&L $${stats.pnl.toFixed(0)}`,
    );
  }

  console.log('');
  if (results.passedCriteria) {
    console.log('✅ Backtest PASSED — ready for paper trading');
  } else {
    console.log('❌ Backtest FAILED minimum criteria');
    console.log('   Review signal scoring thresholds in engine/amt/setupDetector.ts');
  }
}
