"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { Chip } from "@/src/components/apex-ui/Chip";
import { GradeTag } from "@/src/components/apex-ui/GradeTag";
import { PriceDisplay } from "@/src/components/apex-ui/PriceDisplay";
import { SectionHeader } from "@/src/components/apex-ui/SectionHeader";
import { CryptoPairTile } from "@/src/presentation/dashboard/components/CryptoPairTile";
import type { CryptoSignalsPayload } from "@/src/crypto/types";
import { ExecutableSignalCard } from "@/src/dashboard/components/ExecutableSignalCard";
import { MonitoredSignalCard } from "@/src/dashboard/components/MonitoredSignalCard";
import { RejectedSignalCard } from "@/src/dashboard/components/RejectedSignalCard";
import type { TraderSignalDashboardPayload } from "@/src/dashboard/types";

function statusVariant(status: string) {
  if (status === "active") return "active" as const;
  if (status === "blocked" || status === "invalidated" || status === "expired") return "blocked" as const;
  if (status === "watchlist") return "watchlist" as const;
  return "neutral" as const;
}

function biasVariant(bias: string) {
  if (bias === "bullish") return "active" as const;
  if (bias === "bearish") return "blocked" as const;
  return "neutral" as const;
}

export function SignalFeedClient({
  initialPayload,
  forceShowBlocked = false,
}: {
  initialPayload: TraderSignalDashboardPayload;
  forceShowBlocked?: boolean;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [cryptoData, setCryptoData] = useState<CryptoSignalsPayload | null>(null);

  const refresh = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/signals", {
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const next = await response.json() as TraderSignalDashboardPayload;
      setPayload(next);
    } catch {
      // Keep the last good payload on polling failures.
    }
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 10_000);

    return () => window.clearInterval(timer);
  }, []);

  const refreshCrypto = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/crypto-signals", {
        cache: "no-store",
      });
      if (!response.ok) {
        return;
      }
      const next = await response.json() as CryptoSignalsPayload;
      setCryptoData(next);
    } catch {
      // Keep the last good crypto payload on polling failures.
    }
  });

  useEffect(() => {
    void refreshCrypto();
    const timer = window.setInterval(() => {
      void refreshCrypto();
    }, 15_000);

    return () => window.clearInterval(timer);
  }, []);

  const showRejected = forceShowBlocked || payload.rejected.length > 0;

  return (
    <div className="space-y-8">
      <section className="apex-surface px-6 py-5">
        <SectionHeader
          title="Live Market Board"
          count={payload.liveMarketBoard.length}
          subtitle="One row per active FX pair regardless of signal status."
          className="mb-0"
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {payload.liveMarketBoard.map(row => (
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
                <Chip label={row.bias} variant={biasVariant(row.bias)} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="apex-surface px-6 py-5">
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-[var(--apex-border-subtle)] pb-4">
          <span className="font-[var(--apex-font-body)] text-[18px] italic text-[var(--apex-text-primary)]">Crypto</span>
          <span className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            BTC · ETH · SOL · BNB
          </span>
          {cryptoData?.wsConnected ? (
            <span className="ml-auto flex items-center gap-2 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[var(--apex-status-active-text)]">
              <span className="apex-pulse-dot h-1.5 w-1.5 rounded-full bg-[var(--apex-status-active-text)]" />
              Binance WS Live
            </span>
          ) : cryptoData ? (
            <span className="ml-auto font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] text-[#EAB308]">
              Rest Fallback
            </span>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {cryptoData?.liveMarketBoard.map(row => (
            <CryptoPairTile key={row.symbol} row={row} />
          ))}
          {!cryptoData ? (
            <div className="col-span-full rounded-[var(--apex-radius-lg)] border border-dashed border-[var(--apex-border-subtle)] px-4 py-8 text-center text-[13px] italic text-[var(--apex-text-tertiary)]">
              Crypto cycle not yet run. Click &quot;Run Crypto Cycle&quot; to start.
            </div>
          ) : null}
        </div>
      </section>

      {cryptoData?.executable.length ? (
        <section className="space-y-5">
          <SectionHeader
            title="Crypto Executable"
            count={cryptoData.executable.length}
            subtitle="Active crypto setups cleared by SMC analysis."
          />
          <div className="space-y-4">
            {cryptoData.executable.map(signal => (
              <ExecutableSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </section>
      ) : null}

      {cryptoData?.monitored.length ? (
        <section className="space-y-5">
          <SectionHeader
            title="Crypto Monitored"
            count={cryptoData.monitored.length}
            subtitle="Developing crypto setups below the executable floor."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            {cryptoData.monitored.map(signal => (
              <MonitoredSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-5">
        <SectionHeader
          title="Executable"
          count={payload.executable.length}
          subtitle="Approved signals cleared by risk. Grade B and above."
        />
        {payload.executable.length === 0 ? (
          <div className="apex-empty-state">
            No executable signals in this cycle.
            {payload.monitored.length > 0 ? ` ${payload.monitored.length} setups developing.` : ""}
          </div>
        ) : (
          <div className="space-y-4">
            {payload.executable.map(signal => (
              <ExecutableSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-5">
        <SectionHeader
          title="Monitored"
          count={payload.monitored.length}
          subtitle="Developing setups. Below grade floor or risk-deferred. Not yet actionable."
        />
        {payload.monitored.length === 0 ? (
          <div className="apex-empty-state">No monitored setups right now.</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {payload.monitored.map(signal => (
              <MonitoredSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </section>

      {showRejected ? (
        <section className="space-y-4">
          <SectionHeader
            title="Rejected"
            count={payload.rejected.length}
            subtitle="Blocked by risk governor or governance rules."
          />
          {payload.rejected.length === 0 ? (
            <div className="apex-empty-state">No rejected signals in this cycle.</div>
          ) : (
            <div className="space-y-2">
              {payload.rejected.map(signal => (
                <RejectedSignalCard key={signal.id} signal={signal} />
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
