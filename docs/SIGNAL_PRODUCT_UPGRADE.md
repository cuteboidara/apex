# Signal Product Upgrade

This upgrade moves APEX from a live dashboard with basic diagnostics into an intraday-capable, replayable, execution-aware signal platform foundation.

## What changed

- FX and metals now route through Yahoo Finance for quotes, candles, and historical backfill.
- Canonical quote and candle persistence now writes into `QuoteSnapshot` and `Candle`.
- Historical ingestion now has a first-class backfill path:
  - `lib/marketData/backfill.ts`
  - `scripts/backfill-market-data.ts`
  - `/api/admin/backfill`
- Evidence-gated suppression now uses recent realized performance and confidence calibration buckets instead of only style-level heuristics.
- A deterministic replay/backtest API now exists at `/api/backtest`.
- Replay/backtest now auto-prepares missing persisted candles before running. Replay itself still runs only from persisted DB candles and never calls live providers.
- Paper-trading execution APIs now exist at:
  - `/api/execution/accounts`
  - `/api/execution/positions`
- Subscriber-preference foundations now exist at:
  - `/api/me/preferences`
  - `/api/me/watchlists`
- Public signal-history filtering now exists at `/api/history/signals`.
- Queue failures now persist into `DeadLetterJob`.
- Alert delivery attempts now persist into `AlertDeliveryAttempt`.
- Operational metrics now persist into `OperationalMetric`.

## Migration

Apply the new additive migration:

```bash
npm run migrate:deploy
```

Added migration:

- `prisma/migrations/20260323140000_add_signal_product_foundations/migration.sql`

This migration is intentionally additive and idempotent because the existing remote development database had drift and should not be reset.

## Environment

Start from `.env.example`.

Required for the upgraded path:

- `DATABASE_URL` or `DIRECT_DATABASE_URL`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`

Required when queue workers are enabled:

- `REDIS_URL`, `KV_URL`, `UPSTASH_REDIS_URL`, or `UPSTASH_REDIS_TLS_URL`

Optional startup hardening:

- `APEX_STRICT_STARTUP=true`

Optional fallbacks and enrichments:

- `FRED_API_KEY`
- `ANTHROPIC_API_KEY`
- `GEMINI_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `RESEND_API_KEY`

Recommended go-live deterministic runtime:

- `APEX_CORE_SIGNAL_MODE=deterministic`
- `APEX_DISABLE_LLM=true`
- `APEX_LLM_OPTIONAL=true`
- `APEX_DISABLE_NEWS=true`
- `APEX_EVIDENCE_GATE_MIN_SAMPLE_SIZE=20`
- `APEX_EVIDENCE_GATE_MIN_WIN_RATE=0.5`
- `APEX_EVIDENCE_GATE_MIN_EXPECTANCY=0`

In this mode, signal cycles continue without LLM commentary and without RSS/news enrichment. Trade-plan generation, diagnostics, persistence, replay, paper trading, and admin/system visibility remain active.

Quality-gate tuning:

- `APEX_DEGRADED_CONFIDENCE_FLOOR`
- `APEX_STYLE_GATE_LOOKBACK_DAYS`
- `APEX_STYLE_GATE_MIN_SAMPLE_SIZE`
- `APEX_SCALP_GATE_MIN_WIN_RATE`
- `APEX_SCALP_GATE_MIN_AVERAGE_RR`
- `APEX_EVIDENCE_GATE_MIN_SAMPLE_SIZE`
- `APEX_EVIDENCE_GATE_MIN_WIN_RATE`
- `APEX_EVIDENCE_GATE_MIN_EXPECTANCY`

Validate the web-service env locally:

```bash
npm run env:validate
```

For worker and rollout validation:

```bash
node scripts/validate-env.mjs --service=worker --strict
npm run validate:rollout
```

## Historical backfill

Backfill a bounded symbol/date range from the CLI:

```bash
npm run backfill:market -- --symbols=EURUSD,GBPUSD --timeframes=1m,5m,15m --start=2026-01-01 --end=2026-01-14 --resume
```

Backfill an entire asset class:

```bash
npm run backfill:market -- --assetClass=FOREX --timeframes=1h,4h,1D --start=2025-01-01 --end=2026-03-01 --resume
```

Important notes:

- Backfill is idempotent and uses `createMany(..., skipDuplicates: true)` for `Candle` and `QuoteSnapshot`.
- Quote snapshots are derived from candle closes during historical backfill.
- Binance remains the primary historical source for crypto.
- Yahoo Finance remains the primary historical source for FX/metals. Its `4h` fallback is normalized from `60m` candles before persistence.
- BullMQ workers are not required for the CLI backfill path.
- For long 1m ranges, run in batches and use `--max-batches` when you need to cap a single run.

Admin operators can inspect recent backfill metrics and trigger bounded runs at `/api/admin/backfill`.

## Validation

Build:

```bash
npm run build
```

Tests:

```bash
node --import tsx --test tests/strategy-direction.test.ts tests/trade-plan-diagnostics.test.ts tests/provider-registry.test.ts tests/staleness.test.ts tests/market-regime.test.ts tests/confidence-calibration.test.ts tests/backtest-execution.test.ts tests/system-providers-route.test.ts tests/market-backfill.test.ts tests/signup-route.test.ts tests/admin-users-route.test.ts tests/queue-route.test.ts tests/paper-execution-routes.test.ts tests/telegram-service.test.ts tests/env-validation.test.ts
```

## Rollout order

1. Deploy the migration with `npm run migrate:deploy`.
2. Validate env with `npm run validate:rollout`.
3. Deploy web.
4. Deploy worker.
5. If historical replay is needed immediately, run a bounded backfill before the first backtest.
6. Trigger a cycle manually and confirm:
   - `/api/system`
   - `/api/system/providers`
   - `/api/admin/system`
   - `/api/admin/backfill`
   - `/api/performance`
   - `/api/queue`
   - the runtime payload shows `core.status=available` even when commentary/news are intentionally disabled
8. Verify the new provider summary shows Yahoo Finance primary for FX/metals and Binance primary for crypto.
9. Verify `TradeOutcome`, `StrategyPerformanceWindow`, `ConfidenceCalibrationBucket`, and `OperationalMetric` are being populated after completed cycles.
10. Run a bounded backtest and confirm the response includes `coverage` and optional `dataPreparation` metadata.

## Operational notes

- Replay/backtest is deterministic and does not call live providers during replay. If required candles are missing, the route prepares them first and then re-runs from persisted data.
- Paper execution currently supports simulated accounts, positions, fills, mark-to-market, and close flows. It does not yet place real broker orders.
- Queue mutating actions now require admin authorization and write audit events.
- Dead-letter jobs can now be replayed from `/api/queue` even after the original BullMQ job has aged out.
- Signup, admin moderation, paper execution actions, Telegram delivery failures, and queue replay actions now have explicit route/service-level smoke coverage.
- The schema includes commercial foundation models for plans, subscriptions, teams, API tokens, webhooks, exports, and user preferences. External billing integration is still a next step.
- Commentary and RSS/news are optional runtime enrichments. Their failures must not block `SignalRun` completion in deterministic go-live mode.
