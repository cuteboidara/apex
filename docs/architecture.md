# APEX Intelligence — Architecture

## Layer Structure

src/domain/           Pure domain logic. No framework dependencies.
src/application/      Use cases and orchestration.
src/infrastructure/   Database, external APIs, auth, queues.
src/presentation/     API handlers, dashboard components, admin pages.
src/lib/              Shared runtime utilities (trader enrichment, Telegram, live prices).
src/smc/              SMC/ICT analysis modules.
src/pods/             Signal evaluation pods.
src/config/           Market scope and runtime configuration.

## Signal Pipeline

MarketSnapshot → TradeCandidate → RiskEvaluatedCandidate
→ ExecutableSignal → SignalLifecycle → SignalViewModel → UI

## Risk Architecture (Phase 5 — Not Promoted Yet)

Live authority: LegacyRiskParityModule
Shadow evaluation: Decomposed risk modules (Portfolio, MarketConditions,
ExecutionFeasibility, PolicyRules)
Shadow log: RiskShadowLog — monitor for divergence before promotion

Phase 5 gate outcome on 2026-03-28: 9.62% 7-day mismatch rate, so promotion was
not executed and Section 2 remains deferred.

## Key Entry Points

/api/signals          → src/presentation/api/signals.ts
/api/cycle            → app/api/cycle/route.ts → src/application/cycle/runCycle.ts
Daily signals         → app/api/jobs/daily-signals/route.ts
Admin observability   → /admin/risk-shadow | /admin/risk-rules |
                        /admin/data-quality | /admin/conversion

## Active Symbol Universe

EURUSD, GBPUSD, USDJPY, EURJPY, AUDUSD, NZDUSD, USDCHF, USDCAD

## Active Strategies

trend_pullback, session_breakout, range_reversal

## What Is Deliberately Retained

lib/prisma.ts         → re-exports from src/infrastructure/db/prisma.ts
lib/auth.ts           → re-exports from src/infrastructure/auth/auth.ts
lib/requireOperator.ts → re-exports from src/infrastructure/auth/requireOperator.ts
lib/admin/requireAdmin.ts → direct implementation (stable, no reason to move)
