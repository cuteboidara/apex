# Railway Deployment

This project should be deployed to Railway as five services:

1. `apex-web`
2. `apex-worker`
3. `apex-scheduler`
4. `Postgres`
5. `Redis`

## App services

Create three services from the same repository root.

### `apex-web`

- Build command: `npm run build`
- Start command: `npm start`
- Pre-deploy command: `npm run migrate:deploy`
- Healthcheck path: `/api/health`
- Networking: generate a public domain

### `apex-worker`

- Build command: `npm run build`
- Start command: `npm run worker:signal-cycle`
- Restart policy: `ON_FAILURE`
- Networking: private only

### `apex-scheduler`

- Build command: `npm run build`
- Start command: `npm run service:scheduler`
- Restart policy: `ON_FAILURE`
- Networking: private only

## Service variables

Use Railway reference variables so all three app services share the same database and Redis instances.

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
- The worker and scheduler should not have public domains.
- `/api/health` is intentionally lightweight and does not depend on PostgreSQL or Redis, so it is safe to use as the web healthcheck.

## First production deploy

1. Create the `Postgres` and `Redis` services.
2. Create `apex-web`, `apex-worker`, and `apex-scheduler` from this repo.
3. Add the reference variables above to all three app services.
4. Add the provider secrets to the services that need them. In practice, sharing the same secret set across all three app services is simplest.
5. Deploy `apex-web` first and confirm `/api/health` returns `200`.
6. Deploy `apex-worker`.
7. Deploy `apex-scheduler`.
8. Open the generated public domain for `apex-web`.
