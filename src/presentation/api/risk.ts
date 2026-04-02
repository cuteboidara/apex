import type { RiskDashboardPayload } from "@/src/dashboard/types";
import { getApexRuntime } from "@/src/lib/runtime";

export async function getRiskDecisionsPayload() {
  const runtime = getApexRuntime();
  const positions = runtime.repository.getPositions();
  const allocations = runtime.repository.getLatestSignalCandidates(24);
  const decisions = runtime.repository.getRecentRiskDecisions(50);
  const latestPrices = runtime.repository.getLatestFeatureSnapshots(runtime.config.activeSymbols);
  const priceBySymbol = new Map(
    latestPrices.map(snapshot => [snapshot.symbol_canonical, snapshot.features.mid ?? snapshot.features.sma_20 ?? 0]),
  );
  const gross = Object.values(positions).reduce((sum, value) => sum + Math.abs(value), 0);
  const net = Object.values(positions).reduce((sum, value) => sum + value, 0);

  return {
    risk_state: runtime.repository.getRiskState(),
    exposure: {
      gross,
      net,
      active_symbols: Object.values(positions).filter(value => Math.abs(value) > 0).length,
    },
    limits: {
      max_gross_exposure: runtime.config.maxGrossExposure,
      max_net_exposure: runtime.config.maxNetExposure,
      max_symbol_position: runtime.config.maxSymbolPosition,
      max_notional_usd: runtime.config.maxNotionalUsd,
      drawdown_warning_pct: runtime.config.drawdownWarningPct,
      drawdown_hard_limit_pct: runtime.config.drawdownHardLimitPct,
      volatility_target: runtime.config.volatilityTarget,
    },
    positions: Object.entries(positions)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([symbol, currentPosition]) => {
        const price = priceBySymbol.get(symbol) ?? 0;
        const maxPosition = runtime.config.maxSymbolPosition;
        return {
          symbol_canonical: symbol,
          current_position: currentPosition,
          max_position: maxPosition,
          utilization: maxPosition === 0 ? 0 : Math.min(1, Math.abs(currentPosition) / maxPosition),
          current_notional_usd: Math.abs(currentPosition * price),
          max_notional_usd: runtime.config.maxNotionalUsd,
        };
      }),
    decisions: decisions.map(decision => ({
      ...decision,
      reason_codes: [...decision.veto_reasons, ...decision.warning_reasons],
    })),
    allocations,
  } satisfies RiskDashboardPayload;
}
