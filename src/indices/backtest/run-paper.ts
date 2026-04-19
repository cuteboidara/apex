// src/indices/backtest/run-paper.ts
// 14-day paper trading runner
// Run with: npx ts-node src/indices/backtest/run-paper.ts

import { PaperTradeLogger } from './paperTradeLogger';
import { runAMTCycle } from '@/src/indices/runtime';

const SCAN_INTERVAL_H = 4;
const SCAN_INTERVAL_MS = SCAN_INTERVAL_H * 60 * 60 * 1000;
const DURATION_DAYS = Number(process.env.PAPER_DAYS ?? '14');

async function main() {
  console.log('════════════════════════════════════════');
  console.log('  APEX AMT — PAPER TRADING');
  console.log(`  Duration: ${DURATION_DAYS} days`);
  console.log(`  Scan interval: every ${SCAN_INTERVAL_H}h`);
  console.log('════════════════════════════════════════\n');

  const logger = new PaperTradeLogger('paper-trading');
  const endAt = Date.now() + DURATION_DAYS * 24 * 60 * 60 * 1000;
  let cycleNum = 0;

  async function runCycle() {
    cycleNum++;
    console.log(`\n[${new Date().toISOString()}] Starting cycle #${cycleNum}`);

    const result = await runAMTCycle();

    if (!result.success) {
      console.warn(`  Cycle failed: ${result.error}`);
      return;
    }

    console.log(`  Executable: ${result.executableCount} | Watchlist: ${result.watchlistCount}`);
    logger.logCycle(cycleNum, result.signals);
  }

  // Run immediately
  await runCycle();

  // Schedule subsequent cycles
  const interval = setInterval(async () => {
    if (Date.now() >= endAt) {
      clearInterval(interval);
      logger.printSummary();
      console.log('\n✅ Paper trading complete. Check logs + IndicesSignal table.');
      process.exit(0);
    }

    await runCycle().catch(err => console.error('Cycle error:', err));
  }, SCAN_INTERVAL_MS);

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(interval);
    logger.printSummary();
    console.log('\nPaper trading stopped early.');
    process.exit(0);
  });

  console.log(`\nPaper trading running. End at: ${new Date(endAt).toLocaleString()}`);
  console.log('Press Ctrl+C to stop early.\n');
}

main().catch(err => {
  console.error('Paper trading error:', err);
  process.exit(1);
});
