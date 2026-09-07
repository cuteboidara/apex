# APEX Intelligence

**Multi-asset market intelligence and automated signal infrastructure built across FX, crypto, equities, commodities, indices, and emerging assets.**

APEX is a full-stack trading intelligence system that combines market-data ingestion, asset-specific runtimes, signal generation, AI-assisted reasoning, risk controls, persistence, automated scheduling, diagnostics, and Telegram delivery.

Rather than treating every market identically, APEX uses dedicated runtimes and provider strategies for different asset classes.

---

## Architecture

```text
                  ┌──────────────────────────────┐
                  │      Market Data Sources     │
                  │                              │
                  │ OANDA · Binance · Polygon    │
                  │ CoinGecko · Twelve Data      │
                  │ + ranked fallback providers  │
                  └──────────────┬───────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │      Data / Provider Layer   │
                  │                              │
                  │ normalization · fallbacks    │
                  │ cooldowns · stale-data rules │
                  └──────────────┬───────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
          FX Runtime        Crypto Runtime     Asset Runtimes
           OANDA              Binance          Stocks · Indices
                                                Commodities
                                                Meme Assets
              └──────────────────┼──────────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │     Signal Intelligence      │
                  │                              │
                  │ Evidence Gates               │
                  │ Risk / Exposure Controls     │
                  │ LLM Reasoning (optional)     │
                  │ Signal Grading               │
                  └──────────────┬───────────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 ▼               ▼               ▼
             Database         Dashboard       Telegram
            Persistence       / Admin         Delivery
                 │
                 ▼
          Diagnostics & Outcomes
```

---

## Core Systems

### Multi-Asset Runtime

APEX operates across multiple market categories using dedicated runtime paths:

- **FX** — OANDA-backed runtime with canonical signal persistence
- **Crypto** — Binance market runtime
- **Equities** — Polygon-backed stock data
- **Commodities & Indices** — ranked provider fallback architecture
- **Meme Assets** — discovery and runtime using Binance and CoinGecko

This allows provider selection and runtime behaviour to vary according to the characteristics of each asset class.

### Signal Intelligence

The signal layer supports configurable controls around:

- signal generation
- signal grading
- evidence thresholds
- confidence
- expectancy
- historical sample size
- win-rate gates
- risk/reward requirements
- degraded-data behaviour

Signals can be persisted and evaluated rather than existing only as transient model output.

### AI-Assisted Reasoning

APEX supports optional LLM reasoning within the signal pipeline.

The AI layer can be independently enabled or disabled and configured separately from the deterministic market-data and risk systems.

Configuration supports:

- reasoning models
- decision models
- optional LLM operation
- test isolation
- fallback behaviour

The system is designed so core runtime operation does not have to depend entirely on an LLM.

### Risk & Exposure Controls

Runtime-level controls include configurable limits for:

- gross exposure
- net exposure
- maximum position size
- maximum notional exposure
- drawdown warnings
- hard drawdown limits
- slippage
- volatility targets
- active-symbol limits

Additional evidence gates can prevent strategies from operating when their observed performance falls below configured thresholds.

### Provider Resilience

The provider layer includes operational controls for:

- provider rate limits
- temporary failures
- request timeouts
- fallback data sources
- cooldown periods
- degraded outcomes
- live-data requirements

This allows individual provider failures to be handled without treating every upstream error as a complete system failure.

---

## Automated Scheduling

APEX includes an embedded server-side scheduler for continuous operation.

The scheduler can run:

- all-asset analysis cycles
- scheduled signal generation
- session-specific daily signals
- startup runs
- recurring background checks

Default daily signal sessions can be configured independently for:

```text
Asia
London
New York
```

Example:

```env
APEX_DAILY_SIGNALS_ASIA_TIME=00:00
APEX_DAILY_SIGNALS_LONDON_TIME=08:00
APEX_DAILY_SIGNALS_NEW_YORK_TIME=13:00
APEX_DAILY_SIGNALS_TIMEZONE=UTC
```

Manual API triggers remain available for operational control and force-runs.

---

## Signal Delivery

Qualified signals can be delivered through Telegram.

Delivery controls include:

- minimum signal grade
- optional B-grade delivery
- daily signal delivery
- zero-signal summaries
- configurable Telegram destination

This separates signal generation from the downstream notification channel.

---

## Diagnostics

APEX includes diagnostic and verification tooling for evaluating runtime behaviour.

```bash
npm run apex:diagnostics -- --smoke
npm run apex:diagnostics -- --alpha
```

Diagnostic configuration includes:

- smoke-test timeouts
- strict startup behaviour
- degraded confidence floors
- strategy performance gates
- scalp diagnostics
- provider failure cooldowns
- historical lookback windows

---

## Technology

### Application

- Next.js
- TypeScript
- NextAuth
- Prisma
- PostgreSQL / Neon
- Redis / Upstash

### Market Data & Integrations

- OANDA
- Binance
- Polygon
- CoinGecko
- Twelve Data
- FRED
- Telegram

### AI

- Anthropic API
- configurable reasoning/decision models
- optional LLM-assisted signal reasoning

### Infrastructure

- Vercel / Railway-compatible deployment
- server-side scheduling
- REST APIs
- Redis-backed infrastructure
- Prisma persistence
- health monitoring

---

## Runtime Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Core configuration:

```env
DATABASE_URL=
DIRECT_DATABASE_URL=

NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000

APEX_SECRET=

REDIS_URL=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

For Neon deployments, the application can use a pooled `DATABASE_URL` while Prisma schema and migration operations use `DIRECT_DATABASE_URL`.

Provider credentials are configured independently through environment variables.

Never commit real API credentials, authentication secrets, database credentials, or bot tokens.

---

## Local Development

Install dependencies:

```bash
npm install
```

Start development:

```bash
npm run dev
```

Type checking:

```bash
npx tsc --noEmit
```

Run APEX tests:

```bash
npm run test:apex
```

Diagnostics:

```bash
npm run apex:diagnostics -- --smoke
npm run apex:diagnostics -- --alpha
```

---

## Operational Triggers

The embedded scheduler handles normal automated operation.

Manual routes remain available for controlled execution.

### Core Cycle

```text
POST /api/cycle
x-apex-secret: <APEX_SECRET>
```

### Asset Runtimes

```text
POST /api/crypto-cycle-trigger
POST /api/meme-cycle-trigger
POST /api/meme-discovery-trigger
POST /api/all-assets-cycle-trigger
```

These routes require an authorized operator session.

### Daily Signals

```text
POST /api/jobs/daily-signals
x-apex-admin-secret: <APEX_DAILY_SIGNALS_SECRET or APEX_SECRET>
```

---

## Health Monitoring

```text
GET /api/health
```

Runtime health exposes scheduler state including:

```text
scheduler.mode
scheduler.lastRunAt
scheduler.nextRunAt
scheduler.intervalMinutes
scheduler.lastSource
```

This provides visibility into whether the automated runtime is operating and when the next analysis cycle is expected.

---

## Deployment

Typical deployment architecture:

```text
Next.js Application / API
        │
        ├── Vercel or Railway
        │
        ├── PostgreSQL / Neon
        │
        ├── Redis / Upstash
        │
        └── External Market Providers
```

Manual trigger endpoints can also be invoked against the deployed service for operational control.

---

## Engineering Focus

APEX explores the engineering challenges involved in building a persistent, automated market-intelligence system:

- heterogeneous market-data providers
- multi-asset runtime architecture
- provider failure handling
- deterministic controls combined with AI reasoning
- risk and evidence gates
- scheduled execution
- signal persistence
- diagnostics
- downstream signal delivery

The project is intended as market-intelligence and software-engineering infrastructure, not as financial advice or a guarantee of trading performance.
