// src/indices/backtest/run-backtest.ts
// CLI entry point — run with: npx ts-node src/indices/backtest/run-backtest.ts

import { AMTBacktester, printResults } from './backtest';

const startDate = process.env.BACKTEST_START_DATE ?? '2024-01-01';
const endDate   = process.env.BACKTEST_END_DATE   ?? '2024-12-31';
const minScore  = Number(process.env.MIN_SIGNAL_SCORE ?? '50');
const account   = Number(process.env.ACCOUNT_SIZE ?? '10000');

async function main() {
  const backtester = new AMTBacktester({
    startDate,
    endDate,
    minSignalScore: minScore,
    accountSize: account,
    riskPct: 0.01,
    outputDir: process.env.RESULTS_DIR ?? './test-results',
  });

  const results = await backtester.run();
  printResults(results);

  process.exit(results.passedCriteria ? 0 : 1);
}

main().catch(err => {
  console.error('Backtest error:', err);
  process.exit(1);
});
