import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { DataPanel } from "@/src/dashboard/components/DataPanel";
import { MeterBar } from "@/src/dashboard/components/MeterBar";
import { MetricCard } from "@/src/dashboard/components/MetricCard";
import { StatusBadge } from "@/src/dashboard/components/StatusBadge";
import { getRiskPageData, getSystemStatusData } from "@/src/dashboard/data";

function toneForDecision(status: string) {
  if (status === "approved") return "good" as const;
  if (status === "approved_reduced" || status === "deferred") return "warn" as const;
  return "bad" as const;
}

export async function RiskPage() {
  const [risk, status] = await Promise.all([
    getRiskPageData(),
    getSystemStatusData(),
  ]);

  const drawdownUsage = risk.limits.drawdown_hard_limit_pct === 0
    ? 0
    : Math.min(100, (Math.abs(risk.risk_state.current_drawdown_pct) / risk.limits.drawdown_hard_limit_pct) * 100);
  const grossUsage = risk.limits.max_gross_exposure === 0
    ? 0
    : Math.min(100, (risk.exposure.gross / risk.limits.max_gross_exposure) * 100);
  const netUsage = risk.limits.max_net_exposure === 0
    ? 0
    : Math.min(100, (Math.abs(risk.exposure.net) / risk.limits.max_net_exposure) * 100);

  return (
    <ApexShell
      title="Risk Governor"
      subtitle="Supreme authority over drawdown, gross and net exposure, per-symbol sizing, concentration, volatility gating, and kill-switch enforcement."
      mode={status.mode}
    >
      <section className="grid gap-4 md:grid-cols-4">
        <MetricCard
          label="Current Drawdown"
          value={`${risk.risk_state.current_drawdown_pct.toFixed(2)}%`}
          detail={`Warning ${risk.limits.drawdown_warning_pct.toFixed(2)}% • Hard ${risk.limits.drawdown_hard_limit_pct.toFixed(2)}%`}
          tone={drawdownUsage >= 100 ? "bad" : drawdownUsage >= 60 ? "warn" : "good"}
        />
        <MetricCard
          label="Gross Exposure"
          value={risk.exposure.gross.toFixed(3)}
          detail={`Cap ${risk.limits.max_gross_exposure.toFixed(3)}`}
          tone={grossUsage >= 100 ? "bad" : grossUsage >= 75 ? "warn" : "good"}
        />
        <MetricCard
          label="Net Exposure"
          value={risk.exposure.net.toFixed(3)}
          detail={`Cap ±${risk.limits.max_net_exposure.toFixed(3)}`}
          tone={netUsage >= 100 ? "bad" : netUsage >= 75 ? "warn" : "good"}
        />
        <MetricCard
          label="Portfolio Volatility"
          value={risk.risk_state.portfolio_vol_estimate.toFixed(3)}
          detail={`Target ${risk.limits.volatility_target.toFixed(3)}`}
          tone={risk.risk_state.portfolio_vol_estimate > risk.limits.volatility_target ? "warn" : "good"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <DataPanel title="Risk Utilization" eyebrow="Meters">
          <div className="space-y-5">
            <MeterBar
              label="Drawdown"
              value={drawdownUsage}
              valueLabel={`${risk.risk_state.current_drawdown_pct.toFixed(2)}%`}
              tone={drawdownUsage >= 100 ? "bad" : drawdownUsage >= 60 ? "warn" : "good"}
            />
            <MeterBar
              label="Gross Exposure"
              value={grossUsage}
              valueLabel={`${risk.exposure.gross.toFixed(3)} / ${risk.limits.max_gross_exposure.toFixed(3)}`}
              tone={grossUsage >= 100 ? "bad" : grossUsage >= 75 ? "warn" : "good"}
            />
            <MeterBar
              label="Net Exposure"
              value={netUsage}
              valueLabel={`${risk.exposure.net.toFixed(3)} / ±${risk.limits.max_net_exposure.toFixed(3)}`}
              tone={netUsage >= 100 ? "bad" : netUsage >= 75 ? "warn" : "good"}
            />
            <MeterBar
              label="Active Symbols"
              value={status.active_symbols.length === 0 ? 0 : (risk.exposure.active_symbols / status.active_symbols.length) * 100}
              valueLabel={`${risk.exposure.active_symbols} / ${status.active_symbols.length}`}
              tone={risk.exposure.active_symbols >= status.active_symbols.length ? "warn" : "neutral"}
            />
          </div>
        </DataPanel>

        <DataPanel title="Recent Risk Decisions" eyebrow="Approval Trace">
          <div className="overflow-x-auto">
            <table className="apex-table">
              <thead>
                <tr>
                  <th className="py-2 pr-4">Scope</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Multiplier</th>
                  <th className="py-2">Reason Codes</th>
                </tr>
              </thead>
              <tbody>
                {risk.decisions.map((decision, index) => (
                  <tr key={`${decision.scope}-${decision.ts}-${index}`}>
                    <td className="py-3 pr-4 apex-table-highlight">{decision.scope}</td>
                    <td className="py-3 pr-4">
                      <StatusBadge label={decision.approval_status} tone={toneForDecision(decision.approval_status)} />
                    </td>
                    <td className="py-3 pr-4">{decision.approved_size_multiplier.toFixed(2)}</td>
                    <td className="py-3">{decision.reason_codes.join(", ") || "All checks passed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <DataPanel title="Per-Symbol Position Limits" eyebrow="Exposure vs Limit">
          <div className="space-y-3">
            {risk.positions.map(position => (
              <div key={position.symbol_canonical} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-[var(--apex-font-mono)] text-sm text-[var(--apex-text-accent)]">{position.symbol_canonical}</p>
                    <p className="mt-1 font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-tertiary)]">
                      {position.current_position.toFixed(3)} / {position.max_position.toFixed(3)}
                    </p>
                  </div>
                  <StatusBadge
                    label={`${Math.round(position.utilization * 100)}%`}
                    tone={position.utilization >= 1 ? "bad" : position.utilization >= 0.75 ? "warn" : "good"}
                  />
                </div>
                <div className="mt-4 space-y-3">
                  <MeterBar
                    label="Position Limit"
                    value={position.utilization * 100}
                    valueLabel={`${position.current_position.toFixed(3)} / ${position.max_position.toFixed(3)}`}
                    tone={position.utilization >= 1 ? "bad" : position.utilization >= 0.75 ? "warn" : "good"}
                  />
                  <MeterBar
                    label="Notional"
                    value={position.max_notional_usd === 0 ? 0 : (position.current_notional_usd / position.max_notional_usd) * 100}
                    valueLabel={`$${position.current_notional_usd.toFixed(0)} / $${position.max_notional_usd.toFixed(0)}`}
                    tone={position.current_notional_usd >= position.max_notional_usd ? "bad" : position.current_notional_usd >= position.max_notional_usd * 0.75 ? "warn" : "good"}
                  />
                </div>
              </div>
            ))}
            {risk.positions.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No live positions.</p> : null}
          </div>
        </DataPanel>

        <DataPanel title="Allocator Context" eyebrow="Upstream Intent">
          <div className="overflow-x-auto">
            <table className="apex-table">
              <thead>
                <tr>
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Direction</th>
                  <th className="py-2 pr-4">Target</th>
                  <th className="py-2">Reason Codes</th>
                </tr>
              </thead>
              <tbody>
                {risk.allocations.map(intent => (
                  <tr key={intent.candidate_id}>
                    <td className="py-3 pr-4 apex-table-highlight">{intent.symbol_canonical}</td>
                    <td className="py-3 pr-4">{intent.direction}</td>
                    <td className="py-3 pr-4">{intent.target_position.toFixed(3)}</td>
                    <td className="py-3">{[...intent.reason_codes, ...intent.veto_reasons].join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataPanel>
      </section>
    </ApexShell>
  );
}
