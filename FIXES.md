# APEX Targeted Fixes

## Scope

This pass applied only the requested surgical fixes:

1. Scheduler consolidation and health visibility
2. Telegram silent-failure visibility and delivery-attempt auditing
3. Oanda environment and symbol-map mismatch cleanup
4. Economic-event/news gating activation
5. Deprecated Telegram stack clarification

## What Changed

### Scheduler

- Canonical scheduler entry point remains `scripts/apex-scheduler.ts`
- `railway.scheduler.json` now points directly to `scripts/apex-scheduler.ts`
- `scripts/scheduler-service.ts` is now a deprecated shim that delegates to the canonical scheduler
- `package.json` `service:scheduler` now points to the canonical scheduler entry
- Added Redis-backed scheduler heartbeat in `src/lib/schedulerHeartbeat.ts`
- `/api/health` now returns scheduler heartbeat metadata:
  - `startedAt`
  - `lastRunAt`
  - `nextRunAt`
  - `intervalMinutes`
  - `lastSource`
- Added startup console line:
  - `[APEX SCHEDULER] Started. Cycle interval: 15min. Next run: ...`

### Telegram

- `src/lib/telegram.ts` now:
  - logs full Telegram failure payloads
  - persists every send attempt into `AlertDeliveryAttempt`
  - records success/failure, recipient, attemptedAt, provider response, and signal reference when available
- `src/application/cycle/runCycle.ts` now awaits trader alert delivery and logs the result
- `lib/telegram/bot.ts` now logs full Telegram API failure bodies for bot-command sends

### Oanda / FX env mismatch

- Added missing env keys to `.env.example`:
  - `OANDA_API_TOKEN`
  - `OANDA_ENV`
  - `OANDA_API_BASE_URL`
  - `APEX_REQUIRE_LIVE_DATA`
- `TWELVE_DATA_API_KEY` is no longer a hard startup requirement for the FX cycle in `scripts/validate-env.mjs`
- Added missing Oanda symbol mappings:
  - `AUDUSD -> AUD_USD`
  - `NZDUSD -> NZD_USD`
  - `USDCHF -> USD_CHF`
  - `USDCAD -> USD_CAD`
- Oanda failures now log clearly before Yahoo fallback

### Economic events

- Added lightweight high-impact event fetcher in `src/data-plant/economicEvents.ts`
- `DataPlant.refreshEconomicEvents()` now fetches current-day events and replaces the static event set
- FX cycle startup now refreshes economic events before symbol processing
- On failure, the runtime logs:
  - `[APEX EVENTS] Economic calendar unavailable, running without news gating`

### Deprecated Telegram stack cleanup

- `lib/telegramService.ts` is explicitly marked deprecated for active signal delivery
- `lib/telegram/bot.ts` now documents that it handles bot commands only, not active signal alerts
