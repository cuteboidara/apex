# Multi-Provider Fallback System Spec

Goal:
Build a resilient market-data layer so the trading platform never goes blind when a single provider fails.

## Objectives

1. Add multiple providers per asset class
2. Add provider health scoring
3. Add fallback routing
4. Add circuit breaker behavior
5. Add last-known-good cache
6. Add style-aware data readiness gating
7. Expose provider health and fallback behavior in API/UI

---

## Asset-Class Routing

### Crypto
Use:
- primary crypto provider
- fallback crypto provider

### FX
Use:
- primary FX provider
- fallback FX provider

### Metals
Use:
- primary metals provider
- fallback metals provider

Do not use one generic provider path for all assets.

---

## Required Modules

Create:

- lib/marketData/providerRegistry.ts
- lib/marketData/providerSelector.ts
- lib/marketData/providerHealthEngine.ts
- lib/marketData/quoteOrchestrator.ts
- lib/marketData/candleOrchestrator.ts
- lib/marketData/cache/marketCache.ts
- lib/marketData/policies/freshnessPolicy.ts
- lib/marketData/policies/fallbackPolicy.ts
- lib/marketData/policies/quorumPolicy.ts

Add provider-specific adapters and normalizers.

---

## Core Rules

- Never publish fake 0 values.
- Never treat stale data as live.
- Never publish a style unless required timeframes are fresh enough.
- Use fallback providers automatically when primary providers are unhealthy or failing.
- Use cached last-known-good data only within allowed freshness windows.
- Record provider request details and failure reasons.

---

## Freshness Rules

Quotes:
- crypto: 30s
- fx/metals: 60s

Candles:
- 1m: 2m
- 5m: 7m
- 15m: 20m
- 1h: 75m
- 4h: 5h
- 1D: 30h

---

## Health and Circuit Rules

- Track success rate, parse validity, freshness pass rate, latency, rate-limit events, and error streaks
- Score providers from 0–100
- Healthy: 85+
- Degraded: 60–84
- Unhealthy: below 60

Circuit breaker:
- open after repeated failures
- cool down before retry
- half-open test before restoring

---

## Readiness Rules

Expose readiness by style:

- SCALP requires fresh 1m and 5m data
- INTRADAY requires fresh 5m/15m/1h data
- SWING requires fresh 1h/4h/1D data

Do not publish style outputs without readiness.

---

## Persistence

Add/extend tables for:
- ProviderHealth
- MarketDataSnapshot
- ProviderCircuitState

---

## API

Add:
- /api/system/providers
- /api/market/readiness

Enhance:
- /api/market/live

Include:
- selected provider
- fallback used
- freshness
- reasons
- circuit state where relevant

---

## UI

Show:
- provider health
- fallback usage
- data freshness
- style readiness
- degraded/unavailable reason
