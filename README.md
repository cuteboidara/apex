# APEX Intelligence

APEX is a Next.js multi-asset trading system with:

- FX runtime with canonical signal persistence
- crypto runtime on Binance
- stocks runtime on Polygon
- commodities and indices with ranked fallback providers
- meme-coin discovery/runtime on Binance + CoinGecko
- Telegram delivery, admin tooling, diagnostics, and manual API triggers

## Runtime Environment

Required core keys:

```env
DATABASE_URL=postgresql://...-pooler.../neondb
DIRECT_DATABASE_URL=postgresql://.../neondb
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
APEX_SECRET=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
REDIS_URL=redis://localhost:6379
```

For Neon, use the pooled `DATABASE_URL` for the running app and `DIRECT_DATABASE_URL` for Prisma schema and migration commands.

FX provider keys:

```env
OANDA_API_TOKEN=
OANDA_ENV=practice
OANDA_API_BASE_URL=
APEX_REQUIRE_LIVE_DATA=true
```

Optional integrations:

```env
TWELVE_DATA_API_KEY=
ANTHROPIC_API_KEY=
APEX_DISABLE_LLM=false
APEX_ENABLE_CRYPTO=true
POLYGON_API_KEY=
COINGECKO_API_KEY=
APEX_DAILY_SIGNALS_SECRET=
APEX_SHOW_ADMIN_TRIGGER=false
APEX_ALLOW_DAILY_SIGNAL_MEMORY_FALLBACK=false
```

Daily signal scheduling:

```env
APEX_DAILY_SIGNALS_ENABLED=false
APEX_DAILY_SIGNALS_TIME=08:00
APEX_DAILY_SIGNALS_ASIA_TIME=00:00
APEX_DAILY_SIGNALS_LONDON_TIME=08:00
APEX_DAILY_SIGNALS_NEW_YORK_TIME=13:00
APEX_DAILY_SIGNALS_TIMEZONE=UTC
APEX_DAILY_SIGNALS_MIN_GRADE=B
APEX_DAILY_SIGNALS_TELEGRAM_ENABLED=true
APEX_DAILY_SIGNALS_SEND_ZERO_SIGNAL_SUMMARY=true
```

## Local Development

```bash
npm install
npm run dev
```

Useful commands:

```bash
npx tsc --noEmit
npm run test:apex
npm run apex:diagnostics -- --smoke
npm run apex:diagnostics -- --alpha
```

## Manual Triggers

APEX runs in manual-only mode. There is no deployed scheduler service or cron worker.

Trigger the runtime directly through the API:

```text
POST /api/cycle
Header: x-apex-secret: <APEX_SECRET>
```

```text
POST /api/crypto-cycle-trigger
POST /api/meme-cycle-trigger
POST /api/meme-discovery-trigger
POST /api/all-assets-cycle-trigger
Auth: operator session
```

```text
POST /api/jobs/daily-signals
Header: x-apex-admin-secret: <APEX_DAILY_SIGNALS_SECRET or APEX_SECRET>
```

Health endpoint:

```text
GET /api/health
```

The health response exposes manual runtime heartbeat fields:

- `scheduler.mode = "manual"`
- `scheduler.lastRunAt`
- `scheduler.nextRunAt = null`
- `scheduler.intervalMinutes`
- `scheduler.lastSource`

## Deployment

Typical split:

- web/API: Vercel or Railway web service
- manual trigger calls: direct API requests against the deployed web service
