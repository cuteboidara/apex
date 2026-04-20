"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { SectionHeader } from "@/src/components/apex-ui/SectionHeader";
import type { CommoditiesSignalsPayload } from "@/src/assets/commodities/types";
import type { IndicesSignalsPayload } from "@/src/assets/indices/types";
import type { MemeSignalsPayload } from "@/src/assets/memecoins/types";
import type { StocksSignalsPayload } from "@/src/assets/stocks/types";
import type { CryptoSignalsPayload } from "@/src/crypto/types";
import type { SignalViewModel } from "@/src/domain/models/signalPipeline";
import type { TraderSignalDashboardPayload } from "@/src/dashboard/types";
import { ExecutableSignalCard } from "@/src/presentation/dashboard/components/ExecutableSignalCard";
import { MonitoredSignalCard } from "@/src/presentation/dashboard/components/MonitoredSignalCard";
import { RejectedSignalCard } from "@/src/presentation/dashboard/components/RejectedSignalCard";
import { getSignalTrustRank } from "@/src/presentation/dashboard/components/signalPresentation";

type UnifiedFilter = "all" | "fx" | "crypto" | "stock" | "commodity" | "index" | "memecoin";

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  C: 2,
  B: 3,
  A: 4,
  S: 5,
  "S+": 6,
};

function assetFilterValue(signal: SignalViewModel): UnifiedFilter {
  const assetClass = (signal.ui_sections as { assetClass?: string } | null)?.assetClass;
  if (assetClass === "crypto") return "crypto";
  if (assetClass === "stock") return "stock";
  if (assetClass === "commodity") return "commodity";
  if (assetClass === "index") return "index";
  if (assetClass === "memecoin") return "memecoin";
  return "fx";
}

function sortSignals(signals: SignalViewModel[]): SignalViewModel[] {
  return [...signals].sort((left, right) =>
    getSignalTrustRank(right) - getSignalTrustRank(left)
    || (GRADE_RANK[right.grade] ?? -1) - (GRADE_RANK[left.grade] ?? -1)
    || right.gradeScore - left.gradeScore
    || right.confidence - left.confidence
    || left.symbol.localeCompare(right.symbol),
  );
}

export function UnifiedSignalsPageClient({
  initialSignals,
  initialCrypto,
  initialStocks,
  initialCommodities,
  initialIndices,
  initialMemecoins,
}: {
  initialSignals: TraderSignalDashboardPayload;
  initialCrypto: CryptoSignalsPayload;
  initialStocks: StocksSignalsPayload;
  initialCommodities: CommoditiesSignalsPayload;
  initialIndices: IndicesSignalsPayload;
  initialMemecoins: MemeSignalsPayload;
}) {
  const [signals, setSignals] = useState(initialSignals);
  const [crypto, setCrypto] = useState(initialCrypto);
  const [stocks, setStocks] = useState(initialStocks);
  const [commodities, setCommodities] = useState(initialCommodities);
  const [indices, setIndices] = useState(initialIndices);
  const [memecoins, setMemecoins] = useState(initialMemecoins);
  const [selectedFilter, setSelectedFilter] = useState<UnifiedFilter>("all");

  const refresh = useEffectEvent(async () => {
    try {
      const [fxResponse, cryptoResponse, stocksResponse, commoditiesResponse, indicesResponse, memecoinResponse] = await Promise.all([
        fetch("/api/signals", { cache: "no-store" }),
        fetch("/api/crypto/signals", { cache: "no-store" }),
        fetch("/api/stocks/signals", { cache: "no-store" }),
        fetch("/api/commodities/signals", { cache: "no-store" }),
        fetch("/api/indices/signals", { cache: "no-store" }),
        fetch("/api/meme-scanner", { cache: "no-store" }),
      ]);

      const [nextFx, nextCrypto, nextStocks, nextCommodities, nextIndices, nextMemecoins] = await Promise.all([
        fxResponse.ok ? fxResponse.json() : null,
        cryptoResponse.ok ? cryptoResponse.json() : null,
        stocksResponse.ok ? stocksResponse.json() : null,
        commoditiesResponse.ok ? commoditiesResponse.json() : null,
        indicesResponse.ok ? indicesResponse.json() : null,
        memecoinResponse.ok ? memecoinResponse.json() : null,
      ]);

      if (nextFx) setSignals(nextFx as TraderSignalDashboardPayload);
      if (nextCrypto) setCrypto(nextCrypto as CryptoSignalsPayload);
      if (nextStocks) setStocks(nextStocks as StocksSignalsPayload);
      if (nextCommodities) setCommodities(nextCommodities as CommoditiesSignalsPayload);
      if (nextIndices) setIndices(nextIndices as IndicesSignalsPayload);
      if (nextMemecoins) setMemecoins(nextMemecoins as MemeSignalsPayload);
    } catch {
      // Keep last known payloads on polling failure.
    }
  });

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  function filterSignals(input: SignalViewModel[]) {
    return sortSignals(input.filter(signal => selectedFilter === "all" || assetFilterValue(signal) === selectedFilter));
  }

  const executable = filterSignals([
    ...signals.executable,
    ...crypto.executable,
    ...stocks.executable,
    ...commodities.executable,
    ...indices.executable,
    ...memecoins.executable,
  ]);
  const monitored = filterSignals([
    ...signals.monitored,
    ...crypto.monitored,
    ...stocks.monitored,
    ...commodities.monitored,
    ...indices.monitored,
    ...memecoins.monitored,
  ]);
  const rejected = filterSignals([
    ...signals.rejected,
    ...crypto.rejected,
    ...stocks.rejected,
    ...commodities.rejected,
    ...indices.rejected,
    ...memecoins.rejected,
  ]);

  return (
    <div className="space-y-8">
      <section className="apex-surface px-6 py-5">
        <div className="flex flex-wrap gap-2">
          {[
            { label: "All", value: "all" },
            { label: "Forex", value: "fx" },
            { label: "Crypto", value: "crypto" },
            { label: "Stocks", value: "stock" },
            { label: "Commodities", value: "commodity" },
            { label: "Indices", value: "index" },
            { label: "Meme Coins", value: "memecoin" },
          ].map(filter => {
            const active = selectedFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => setSelectedFilter(filter.value as UnifiedFilter)}
                className={`rounded-full border px-3 py-1.5 font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.12em] transition ${
                  active
                    ? "border-[var(--apex-border-strong)] bg-[var(--apex-bg-raised)] text-[var(--apex-text-primary)]"
                    : "border-[var(--apex-border-subtle)] text-[var(--apex-text-tertiary)] hover:border-[var(--apex-border-default)] hover:text-[var(--apex-text-secondary)]"
                }`}
              >
                {filter.label}
              </button>
            );
          })}
        </div>
        <p className="mt-4 text-[13px] text-[var(--apex-text-secondary)]">
          Unified feed across forex, crypto, stocks, commodities, indices, and meme coins. Sort order favors publishability, provider trust, then grade.
        </p>
      </section>

      <section className="space-y-5">
        <SectionHeader
          title="Executable"
          count={executable.length}
          subtitle="Approved multi-asset setups, ranked by trust, provider health, and grade."
        />
        {executable.length === 0 ? (
          <div className="apex-empty-state">No executable multi-asset setups are active for the current filter.</div>
        ) : (
          <div className="space-y-4">
            {executable.map(signal => (
              <ExecutableSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-5">
        <SectionHeader
          title="Monitored"
          count={monitored.length}
          subtitle="Developing structure, closed-market context, or below-floor ideas across all active modules."
        />
        {monitored.length === 0 ? (
          <div className="apex-empty-state">No monitored multi-asset setups are active for the current filter.</div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {monitored.map(signal => (
              <MonitoredSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        )}
      </section>

      {rejected.length > 0 ? (
        <section className="space-y-5">
          <SectionHeader
            title="Rejected"
            count={rejected.length}
            subtitle="Blocked setups or unavailable-data reads across the current filter."
          />
          <div className="space-y-2">
            {rejected.map(signal => (
              <RejectedSignalCard key={signal.id} signal={signal} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

