// src/indices/backtest/diagnose.ts
// Full health check for the AMT indices system
// Run: node --import tsx src/indices/backtest/diagnose.ts

import { ASSET_CONFIG, ASSET_SYMBOLS, type AssetSymbol } from '@/src/indices/data/fetchers/assetConfig';
import { fetchYahooCandles } from '@/src/indices/data/fetchers/yahooFinance';
import { fetchDXY, fetchVIX, fetchYield10Y, fetchFearGreed, fetchEconomicCalendar } from '@/src/indices/data/fetchers/macroFetcher';
import { runSMCAnalysis } from '@/src/indices/engine/smc/smcScorer';
import { detectFairValueArea } from '@/src/indices/engine/amt/fairValueDetector';
import { analyzeCandles, detectSequentialPatterns } from '@/src/indices/engine/amt/candleAnalyzer';
import { detectAMTSetups } from '@/src/indices/engine/amt/setupDetector';
import { isRedisConfigured, getCachedJson, setCachedJson } from '@/src/lib/redis';
import type { MacroContext } from '@/src/indices/types';

// ─── Helpers ───────────────────────────────────────────────────────────────

const OK   = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m⚠\x1b[0m';

interface CheckResult {
  name: string;
  ok: boolean;
  warn?: boolean;
  detail: string;
  ms?: number;
}

const results: CheckResult[] = [];

function pass(name: string, detail: string, ms?: number): CheckResult {
  const r = { name, ok: true, detail, ms };
  results.push(r);
  const t = ms !== undefined ? ` \x1b[2m(${ms}ms)\x1b[0m` : '';
  console.log(`  ${OK}  ${name.padEnd(38)} ${detail}${t}`);
  return r;
}

function fail(name: string, detail: string, ms?: number): CheckResult {
  const r = { name, ok: false, detail, ms };
  results.push(r);
  const t = ms !== undefined ? ` \x1b[2m(${ms}ms)\x1b[0m` : '';
  console.log(`  ${FAIL}  ${name.padEnd(38)} \x1b[31m${detail}\x1b[0m${t}`);
  return r;
}

function warn(name: string, detail: string, ms?: number): CheckResult {
  const r = { name, ok: true, warn: true, detail, ms };
  results.push(r);
  const t = ms !== undefined ? ` \x1b[2m(${ms}ms)\x1b[0m` : '';
  console.log(`  ${WARN}  ${name.padEnd(38)} \x1b[33m${detail}\x1b[0m${t}`);
  return r;
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  console.log('─'.repeat(60));
}

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T | null; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    const result = await fn();
    return { result, ms: Date.now() - t0 };
  } catch (e) {
    return { result: null, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Checks ────────────────────────────────────────────────────────────────

async function checkEnv() {
  section('1. ENVIRONMENT');

  const vars: Array<{ key: string; required: boolean }> = [
    { key: 'DATABASE_URL',        required: true },
    { key: 'DIRECT_DATABASE_URL', required: false },
    { key: 'REDIS_URL',           required: false },
    { key: 'FINNHUB_API_KEY',     required: false },
    { key: 'TELEGRAM_BOT_TOKEN',  required: false },
    { key: 'TELEGRAM_CHAT_ID',    required: false },
  ];

  for (const { key, required } of vars) {
    const val = process.env[key];
    if (val) {
      pass(key, `set (${val.length} chars)`);
    } else if (required) {
      fail(key, 'MISSING — required');
    } else {
      warn(key, 'not set (optional)');
    }
  }
}

async function checkYahooFinance() {
  section('2. YAHOO FINANCE DATA');

  // Test 2 indices + 1 forex to keep it fast
  const testAssets: AssetSymbol[] = ['NAS100', 'EURUSD', 'DAX'];

  for (const assetId of testAssets) {
    const cfg = ASSET_CONFIG[assetId];
    const { result, ms, error } = await timed(() =>
      fetchYahooCandles(cfg.yahooSymbol, '1d', 50),
    );

    if (error || !result) {
      fail(`${assetId} (${cfg.yahooSymbol})`, error ?? 'no data', ms);
      continue;
    }

    const { candles, currentPrice } = result;
    if (candles.length === 0) {
      fail(`${assetId} (${cfg.yahooSymbol})`, '0 candles returned', ms);
    } else if (!currentPrice) {
      warn(`${assetId} (${cfg.yahooSymbol})`, `${candles.length} candles, no live price`, ms);
    } else {
      pass(`${assetId} (${cfg.yahooSymbol})`, `${candles.length} candles, price=${currentPrice.toFixed(4)}`, ms);
    }
  }

  // Full asset count check
  let successCount = 0;
  for (const assetId of ASSET_SYMBOLS) {
    const cfg = ASSET_CONFIG[assetId];
    const { result } = await timed(() => fetchYahooCandles(cfg.yahooSymbol, '1d', 10));
    if (result && result.candles.length > 0) successCount++;
  }

  if (successCount === ASSET_SYMBOLS.length) {
    pass('All 7 assets reachable', `${successCount}/${ASSET_SYMBOLS.length} OK`);
  } else {
    fail('All 7 assets reachable', `only ${successCount}/${ASSET_SYMBOLS.length} returned data`);
  }
}

async function checkMacro() {
  section('3. MACRO DATA');

  const { result: dxy, ms: ms1, error: e1 } = await timed(() => fetchDXY());
  if (e1 || !dxy) {
    fail('DXY', e1 ?? 'null', ms1);
  } else {
    pass('DXY', `${dxy.price.toFixed(2)} (${dxy.trend})`, ms1);
  }

  const { result: vix, ms: ms2, error: e2 } = await timed(() => fetchVIX());
  if (e2 || !vix) {
    fail('VIX', e2 ?? 'null', ms2);
  } else {
    pass('VIX', `${vix.price.toFixed(2)} (${vix.regime})`, ms2);
  }

  const { result: yield10y, ms: ms3, error: e3 } = await timed(() => fetchYield10Y());
  if (e3 || !yield10y) {
    fail('10Y Yield', e3 ?? 'null', ms3);
  } else {
    pass('10Y Yield', `${yield10y.price.toFixed(3)}% (${yield10y.trend})`, ms3);
  }

  const { result: sentiment, ms: ms4, error: e4 } = await timed(() => fetchFearGreed());
  if (e4 || !sentiment) {
    warn('Fear & Greed', e4 ?? 'null — using neutral fallback', ms4);
  } else {
    pass('Fear & Greed', `${sentiment.fearGreed}/100 (${sentiment.classification})`, ms4);
  }

  const { result: calendar, ms: ms5, error: e5 } = await timed(() => fetchEconomicCalendar());
  if (e5) {
    warn('Economic Calendar', `${e5} — Finnhub key may be missing`, ms5);
  } else {
    const high = (calendar ?? []).filter(e => e.impact === 'high').length;
    pass('Economic Calendar', `${(calendar ?? []).length} events (${high} high-impact)`, ms5);
  }
}

async function checkRedis() {
  section('4. REDIS CACHE');

  if (!isRedisConfigured()) {
    warn('Redis connection', 'REDIS_URL not set — using in-memory fallback');
    pass('In-memory cache', 'available as fallback');
    return;
  }

  const testKey = '__apex_diagnose_test__';
  const testVal = { ts: Date.now() };

  const { ms: wMs, error: wErr } = await timed(() => setCachedJson(testKey, testVal, 10));
  if (wErr) {
    fail('Redis write', wErr, wMs);
    return;
  }
  pass('Redis write', 'OK', wMs);

  const { result: readback, ms: rMs, error: rErr } = await timed(() => getCachedJson<typeof testVal>(testKey));
  if (rErr || !readback) {
    fail('Redis read', rErr ?? 'null readback', rMs);
  } else if (readback.ts !== testVal.ts) {
    fail('Redis round-trip', `value mismatch: wrote ${testVal.ts}, got ${readback.ts}`, rMs);
  } else {
    pass('Redis read/round-trip', 'value matches', rMs);
  }
}

async function checkDatabase() {
  section('5. DATABASE (Prisma)');

  if (!process.env.DATABASE_URL && !process.env.DIRECT_DATABASE_URL) {
    fail('DB connection', 'DATABASE_URL not set');
    return;
  }

  // Dynamic import to avoid crashing early if DB is unavailable
  const { result, ms, error } = await timed(async () => {
    const { prisma } = await import('@/src/infrastructure/db/prisma');
    await prisma.$queryRaw`SELECT 1`;
    return true;
  });

  if (error) {
    fail('DB connection', error.slice(0, 80), ms);
  } else {
    pass('DB connection', 'SELECT 1 OK', ms);
  }

  // Check IndicesSignal table exists
  const { result: count, ms: ms2, error: e2 } = await timed(async () => {
    const { prisma } = await import('@/src/infrastructure/db/prisma');
    return prisma.indicesSignal.count();
  });

  if (e2) {
    fail('IndicesSignal table', `${e2.slice(0, 80)} — run: npx prisma db push`, ms2);
  } else {
    pass('IndicesSignal table', `${count} records`, ms2);
  }
}

async function checkAMTEngine() {
  section('6. AMT ENGINE');

  // Fetch real candles for one asset
  const { result: data, ms: fetchMs, error: fetchErr } = await timed(() =>
    fetchYahooCandles('NQ=F', '1d', 60),
  );

  if (fetchErr || !data || data.candles.length < 15) {
    fail('Candle fetch for engine test', fetchErr ?? 'insufficient candles', fetchMs);
    return;
  }

  const candles = data.candles;
  const currentPrice = data.currentPrice ?? candles.at(-1)!.close;

  // FVA
  const { result: fva, ms: fvaMs, error: fvaErr } = await timed(async () =>
    detectFairValueArea(candles),
  );
  if (fvaErr || !fva) {
    fail('FairValueArea detection', fvaErr ?? 'null', fvaMs);
  } else {
    pass('FairValueArea detection', `VWAP=${fva.center.toFixed(2)}, band=${(fva.bandWidthPct * 100).toFixed(2)}%, strength=${fva.strength}%`, fvaMs);
  }

  // Candle analyzer
  const { result: analyses, ms: caMs, error: caErr } = await timed(async () => {
    const a = analyzeCandles(candles, 10);
    const p = detectSequentialPatterns(a);
    return { analyses: a, patterns: p };
  });
  if (caErr || !analyses) {
    fail('Candle analyzer', caErr ?? 'null', caMs);
  } else {
    const { analyses: a, patterns: p } = analyses;
    const lastQ = a.at(-1)?.quality ?? 0;
    pass('Candle analyzer', `${a.length} candles, ${p.length} patterns, last quality=${lastQ}/10`, caMs);
  }

  // SMC analysis
  const { result: smc, ms: smcMs, error: smcErr } = await timed(async () =>
    runSMCAnalysis('NAS100', candles),
  );
  if (smcErr) {
    fail('SMC analysis', smcErr, smcMs);
  } else if (!smc) {
    warn('SMC analysis', 'returned null (insufficient data or no OB found)', smcMs);
  } else {
    pass('SMC analysis', `OB ${smc.orderBlock.type} @ ${smc.orderBlock.mid.toFixed(2)}, score=${smc.smcScore}/40`, smcMs);
  }

  // Full AMT setup detection
  const macro: MacroContext = {
    timestamp: new Date(),
    dxy: { price: 103.5, change24h: 0, trend: 'neutral', sma20: 103.5, strength: 'neutral' },
    vix: { price: 16, change24h: 0, regime: 'normal' },
    yield10y: { price: 4.3, change5d: 0, trend: 'stable' },
    sentiment: { fearGreed: 50, classification: 'neutral' },
    economicEvents: [],
  };

  const { result: setups, ms: setupMs, error: setupErr } = await timed(async () =>
    detectAMTSetups({
      assetId: 'NAS100',
      candles,
      orderBlocks: smc ? [smc.orderBlock] : [],
      fvgs: smc?.fvg ? [smc.fvg] : [],
      macro,
      currentPrice,
    }),
  );

  if (setupErr) {
    fail('AMT setup detection', setupErr, setupMs);
  } else if (!setups || setups.length === 0) {
    warn('AMT setup detection', 'no setups this run (normal — market may not have a signal)', setupMs);
  } else {
    const best = setups[0];
    pass('AMT setup detection', `${setups.length} setup(s) — best: ${best.setupType} ${best.direction} score=${best.totalScore}`, setupMs);
  }
}

async function checkTelegram() {
  section('7. TELEGRAM');

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    warn('Telegram config', 'BOT_TOKEN or CHAT_ID not set — alerts disabled');
    return;
  }

  const { result, ms, error } = await timed(async () => {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, { signal: AbortSignal.timeout(5000) });
    return res.json() as Promise<{ ok: boolean; result?: { username: string } }>;
  });

  if (error || !result) {
    fail('Telegram bot auth', error ?? 'no response', ms);
  } else if (!result.ok) {
    fail('Telegram bot auth', 'API returned ok=false — check BOT_TOKEN', ms);
  } else {
    pass('Telegram bot auth', `@${result.result?.username ?? 'unknown'}`, ms);
    warn('Telegram send test', 'skipped (would send a real message)');
  }
}

// ─── Summary ───────────────────────────────────────────────────────────────

function printSummary() {
  const failed  = results.filter(r => !r.ok);
  const warned  = results.filter(r => r.ok && r.warn);
  const passed  = results.filter(r => r.ok && !r.warn);
  const total   = results.length;

  console.log('\n' + '═'.repeat(60));
  console.log('\x1b[1m  DIAGNOSIS SUMMARY\x1b[0m');
  console.log('═'.repeat(60));
  console.log(`  ${OK}  Passed:   ${passed.length}/${total}`);
  if (warned.length)  console.log(`  ${WARN}  Warnings: ${warned.length}/${total}`);
  if (failed.length)  console.log(`  ${FAIL}  Failed:   ${failed.length}/${total}`);

  if (failed.length > 0) {
    console.log('\n\x1b[31mFailed checks:\x1b[0m');
    for (const f of failed) {
      console.log(`  ${FAIL}  ${f.name}: ${f.detail}`);
    }
    console.log('');
  }

  if (failed.length === 0 && warned.length <= 2) {
    console.log('\n  \x1b[32m✅  System is healthy — ready to backtest\x1b[0m');
  } else if (failed.length === 0) {
    console.log('\n  \x1b[33m⚠   System functional with warnings — check above\x1b[0m');
  } else {
    console.log('\n  \x1b[31m❌  Fix the failed checks before running the backtest\x1b[0m');
  }

  console.log('');
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n\x1b[1m  APEX AMT — SYSTEM DIAGNOSTICS\x1b[0m');
  console.log(`  ${new Date().toLocaleString()}`);
  console.log('═'.repeat(60));

  await checkEnv();
  await checkYahooFinance();
  await checkMacro();
  await checkRedis();
  await checkDatabase();
  await checkAMTEngine();
  await checkTelegram();

  printSummary();
}

main().catch(err => {
  console.error('\nDiagnostic crash:', err);
  process.exit(1);
});
