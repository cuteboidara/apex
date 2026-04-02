import { ApexShell } from "@/src/dashboard/components/ApexShell";
import { DataPanel } from "@/src/dashboard/components/DataPanel";
import { SignalFeedClient } from "@/src/dashboard/components/SignalFeedClient";
import { SystemControls } from "@/src/presentation/dashboard/components/SystemControls";
import { LiveNewsPanel } from "@/src/presentation/dashboard/components/overview/LiveNewsPanel";
import { RunControlPanel } from "@/src/presentation/dashboard/components/overview/RunControlPanel";
import { TradeSectionsPanel } from "@/src/presentation/dashboard/components/overview/TradeSectionsPanel";
import { getOverviewData } from "@/src/dashboard/data";
import { Chip } from "@/src/components/apex-ui/Chip";
import { GradeTag } from "@/src/components/apex-ui/GradeTag";
import { PriceDisplay } from "@/src/components/apex-ui/PriceDisplay";

function formatReadiness(status: string | undefined) {
  if (!status) {
    return "offline";
  }

  if (status === "healthy") {
    return "ready";
  }

  return status;
}

function readinessTone(value: string) {
  if (value === "ready") {
    return "text-[var(--apex-status-active-text)]";
  }
  if (value === "degraded") {
    return "text-[var(--apex-status-watchlist-text)]";
  }
  return "text-[var(--apex-status-blocked-text)]";
}

function statusVariant(status: string) {
  if (status === "active") {
    return "active" as const;
  }
  if (status === "blocked") {
    return "blocked" as const;
  }
  if (status === "watchlist") {
    return "watchlist" as const;
  }
  return "neutral" as const;
}

export async function SystemOverviewPage() {
  const { status, signals, crypto, risk, quality, journal } = await getOverviewData();
  const readiness = formatReadiness(status.readiness?.market_data_status);
  const activeAssetRows = status.active_symbols.map(symbol => {
    const liveRow = signals.liveMarketBoard.find(row => row.symbol === symbol);

    return {
      symbol,
      livePrice: liveRow?.livePrice ?? null,
      grade: liveRow?.grade ?? null,
      session: liveRow?.session ?? "Awaiting cycle",
      bias: liveRow?.bias ?? "neutral",
      status: liveRow?.status ?? "watchlist",
    };
  });
  const counts = [
    {
      label: "LIVE BOARD",
      value: String(signals.liveMarketBoard.length),
      tone: "text-[var(--apex-text-primary)]",
      detail: "Tracked pairs on the board.",
    },
    {
      label: "EXECUTABLE",
      value: String(signals.executable.length),
      tone: signals.executable.length > 0 ? "text-[var(--apex-status-active-text)]" : "text-[var(--apex-text-tertiary)]",
      detail: "Approved and actionable.",
    },
    {
      label: "MONITORED",
      value: String(signals.monitored.length),
      tone: signals.monitored.length > 0 ? "text-[var(--apex-status-watchlist-text)]" : "text-[var(--apex-text-tertiary)]",
      detail: "Developing or deferred.",
    },
    {
      label: "REJECTED",
      value: String(signals.rejected.length),
      tone: signals.rejected.length > 0 ? "text-[var(--apex-status-blocked-text)]" : "text-[var(--apex-text-tertiary)]",
      detail: "Blocked by governance.",
    },
  ];

  return (
    <ApexShell
      title="Overview"
      subtitle="Private FX signal runtime. Eight liquid FX pairs. Three active strategies. Governance-first market state and signal delivery."
      mode={status.mode}
    >
      <section
        className="apex-surface grid gap-5 px-6 py-5 xl:grid-cols-4 xl:divide-x xl:divide-[var(--apex-border-subtle)]"
      >
        <div className="space-y-2 xl:pr-6">
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.15em] text-[var(--apex-text-tertiary)]">Runtime</p>
          <p className="font-[var(--apex-font-body)] text-[20px] font-semibold text-[var(--apex-text-primary)]">{status.mode.replaceAll("_", " ")}</p>
          <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">{status.active_symbols.join(" · ")}</p>
        </div>
        <div className="space-y-2 xl:px-6">
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.15em] text-[var(--apex-text-tertiary)]">Last Cycle</p>
          <p className="font-[var(--apex-font-mono)] text-[22px] text-[var(--apex-text-accent)]">
            {status.last_cycle_ts ? new Date(status.last_cycle_ts).toLocaleTimeString() : "No cycle"}
          </p>
          <p className="text-[11px] text-[var(--apex-text-tertiary)]">
            {status.last_cycle_ts ? new Date(status.last_cycle_ts).toLocaleDateString() : "Awaiting first run"}
          </p>
        </div>
        <div className="space-y-2 xl:px-6">
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.15em] text-[var(--apex-text-tertiary)]">Readiness</p>
          <p className={`font-[var(--apex-font-body)] text-[20px] font-semibold ${readinessTone(readiness)}`}>{readiness}</p>
          <p className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-tertiary)]">
            latency {status.readiness?.provider_latency_ms?.toFixed(0) ?? "0"} ms
          </p>
        </div>
        <div className="space-y-2 xl:pl-6">
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.15em] text-[var(--apex-text-tertiary)]">Telegram Floor</p>
          <GradeTag grade={signals.preferences.minimumTelegramGrade} className="text-[24px]" />
          <p className="text-[11px] text-[var(--apex-text-secondary)]">
            {signals.preferences.includeBTelegramSignals ? "B signals included" : "B signals excluded"}
          </p>
        </div>
      </section>

      <SystemControls mode={status.mode} killSwitchActive={status.kill_switch_active} />
      <RunControlPanel />

      <section className="apex-surface px-6 py-5">
        <div className="flex flex-col gap-2 border-b border-[var(--apex-border-subtle)] pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Active Assets</p>
            <h2 className="mt-1 text-[16px] font-semibold text-[var(--apex-text-primary)]">Focused Runtime Coverage</h2>
          </div>
          <p className="text-[12px] text-[var(--apex-text-secondary)]">
            {activeAssetRows.length} symbols are now surfaced directly in the overview UI.
          </p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {activeAssetRows.map(row => (
            <article
              key={row.symbol}
              className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-[var(--apex-font-mono)] text-[13px] font-medium text-[var(--apex-text-primary)]">{row.symbol}</p>
                  <p className="mt-1 text-[11px] text-[var(--apex-text-tertiary)]">{row.session}</p>
                </div>
                {row.grade ? <GradeTag grade={row.grade} /> : <span className="font-[var(--apex-font-mono)] text-[16px] text-[var(--apex-text-tertiary)]">—</span>}
              </div>

              <div className="mt-4">
                <PriceDisplay price={row.livePrice} size="md" />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Chip label={row.status} variant={statusVariant(row.status)} />
                <Chip label={row.bias} variant={row.bias === "bullish" ? "active" : row.bias === "bearish" ? "blocked" : "neutral"} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        {counts.map(item => (
          <article
            key={item.label}
            className="apex-surface px-5 py-4"
          >
            <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">{item.label}</p>
            <p className={`mt-3 font-[var(--apex-font-mono)] text-[40px] leading-none ${item.label === "LIVE BOARD" ? "text-[var(--apex-text-primary)]" : item.tone}`}>{item.value}</p>
            <p className="mt-3 max-w-[180px] text-[12px] text-[var(--apex-text-tertiary)]">{item.detail}</p>
          </article>
        ))}
      </section>

      <section className="apex-surface px-5 py-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            Crypto
          </span>
          <span className={`font-[var(--apex-font-mono)] text-[11px] ${crypto.wsConnected ? "text-[var(--apex-status-active-text)]" : "text-[#EAB308]"}`}>
            {crypto.wsConnected ? "Binance WS Connected" : "REST Fallback"}
          </span>
          <span className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">
            {crypto.liveMarketBoard.length} pairs
          </span>
          <span className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-secondary)]">
            {crypto.cards.length} cards
          </span>
          <span className="font-[var(--apex-font-mono)] text-[11px] text-[var(--apex-text-tertiary)]">
            BTC · ETH · SOL · BNB
          </span>
          {crypto.lastCycleAt ? (
            <span className="ml-auto font-[var(--apex-font-mono)] text-[10px] text-[var(--apex-text-tertiary)]">
              Last: {new Date(crypto.lastCycleAt).toLocaleTimeString()}
            </span>
          ) : null}
        </div>
      </section>

      {signals.marketCommentary ? (
        <section
          className="apex-surface px-6 py-5"
        >
          <div className="mb-4 font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            Market Commentary — AI Generated
          </div>
          <p className="mb-3 text-[14px] leading-7 text-[var(--apex-text-secondary)]">{signals.marketCommentary.overallContext}</p>
          <p className="mb-2 text-[13px] leading-6 text-[var(--apex-text-tertiary)]">{signals.marketCommentary.sessionNote}</p>
          {signals.marketCommentary.topOpportunity ? (
            <p className="mb-2 font-[var(--apex-font-mono)] text-[12px] text-[var(--apex-text-accent)]">
              {signals.marketCommentary.topOpportunity}
            </p>
          ) : null}
          <p className="text-[12px] text-[var(--apex-text-tertiary)]">{signals.marketCommentary.riskNote}</p>
        </section>
      ) : null}

      <SignalFeedClient initialPayload={signals} />

      {signals.preferences.showAdvancedInternals ? (
        <section className="grid gap-4 xl:grid-cols-3">
          <DataPanel title="Risk Snapshot" eyebrow="Advanced Internals">
            <div className="space-y-3 text-sm text-[var(--apex-text-secondary)]">
              <p>Gross exposure {risk.exposure.gross.toFixed(3)}</p>
              <p>Net exposure {risk.exposure.net.toFixed(3)}</p>
              <p>Drawdown {risk.risk_state.current_drawdown_pct.toFixed(2)}%</p>
              <p>Portfolio vol {risk.risk_state.portfolio_vol_estimate.toFixed(3)}</p>
            </div>
          </DataPanel>

          <DataPanel title="Quality Snapshot" eyebrow="Advanced Internals">
            <div className="space-y-3 text-sm text-[var(--apex-text-secondary)]">
              <p>Signals issued {quality.totals.signals_issued}</p>
              <p>Signals activated {quality.totals.signals_activated}</p>
              <p>TP1 hit rate {Math.round(quality.totals.tp1_hit_rate * 100)}%</p>
              <p>Stop rate {Math.round(quality.totals.stop_out_rate * 100)}%</p>
            </div>
          </DataPanel>

          <DataPanel title="Recent Journal" eyebrow="Advanced Internals">
            <div className="space-y-3">
              {journal.slice(0, 3).map(entry => (
                <article key={entry.decision_id} className="rounded-[var(--apex-radius-md)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-4 py-4 text-sm leading-6 text-[var(--apex-text-secondary)]">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-[var(--apex-font-mono)] text-xs text-[var(--apex-text-accent)]">{entry.symbol_canonical}</p>
                    <Chip
                      label={entry.final_action.toUpperCase()}
                      variant={entry.final_action === "executed" ? "active" : entry.final_action === "deferred" ? "watchlist" : "blocked"}
                    />
                  </div>
                  <p className="mt-2">{entry.human_summary}</p>
                </article>
              ))}
              {journal.length === 0 ? <p className="text-sm text-[var(--apex-text-tertiary)]">No journal entries yet.</p> : null}
            </div>
          </DataPanel>
        </section>
      ) : null}

      <TradeSectionsPanel />
      <LiveNewsPanel />
    </ApexShell>
  );
}
