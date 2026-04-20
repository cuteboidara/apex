# Railway Deployment

APEX supports embedded server-side scheduling on Railway. Deploy the web app and use direct API calls for manual overrides/force-runs when needed.

Recommended services:

1. `apex-web`
2. `Postgres`
3. `Redis` (optional but recommended for cache and heartbeat storage)

### `apex-web`

- Build command: `npm run build`
- Start command: `npm start`
- Pre-deploy command: `npm run migrate:deploy`
- Healthcheck path: `/api/health`
- Networking: generate a public domain

## Service variables

Use Railway reference variables so the web app shares the same database and optional Redis instance.

### Shared infrastructure variables

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `DIRECT_DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `REDIS_URL=${{Redis.REDIS_URL}}`

### Provider and alerting variables

- `ANTHROPIC_API_KEY`
- `FRED_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## Deployment notes

- `npm start` uses `scripts/start-web.mjs`, which binds Next.js to `0.0.0.0` and Railway's injected `PORT`.
- `npm run migrate:deploy` should run on the web service before each deploy so schema changes are applied once per release.
- `/api/health` is intentionally lightweight and does not depend on PostgreSQL or Redis, so it is safe to use as the web healthcheck.
- Auto scheduler defaults: all-assets cycle loop + daily-signal session checks run inside the web process.
- Signal generation can still be triggered manually through authenticated API calls such as `/api/cycle`, `/api/crypto-cycle-trigger`, `/api/meme-cycle-trigger`, `/api/meme-discovery-trigger`, `/api/all-assets-cycle-trigger`, and `/api/jobs/daily-signals`.

## First production deploy

1. Create the `Postgres` service and add `Redis` if you want shared cache and heartbeat state.
2. Create `apex-web` from this repo.
3. Add the reference variables above to the web service.
4. Add the provider and auth secrets needed by your enabled modules.
5. Deploy `apex-web` and confirm `/api/health` returns `200`.
6. Verify `/api/health` reports scheduler heartbeat activity (`mode`, `lastRunAt`, `nextRunAt`).
7. Use secured API routes for manual/force triggers when needed.
