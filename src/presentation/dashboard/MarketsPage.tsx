import Link from "next/link";

import { Chip } from "@/src/components/apex-ui/Chip";
import { ApexShell } from "@/src/dashboard/components/ApexShell";
import {
  ALL_COMMODITY_SYMBOLS,
} from "@/src/assets/commodities/config/commoditiesScope";
import { INDICES_SYMBOLS, isIndexMarketOpen } from "@/src/assets/indices/config/indicesScope";
import { ALL_STOCK_SYMBOLS, MARKET_HOURS } from "@/src/assets/stocks/config/stocksScope";
import {
  getCommoditiesPageData,
  getCryptoPageData,
  getIndicesPageData,
  getMemePageData,
  getSignalsPageData,
  getStocksPageData,
  getSystemStatusData,
} from "@/src/dashboard/data";

const GRADE_RANK: Record<string, number> = {
  F: 0,
  D: 1,
  C: 2,
  B: 3,
  A: 4,
  S: 5,
  "S+": 6,
};

function bestGrade(cards: Array<{ grade: string }>): string {
  return [...cards]
    .sort((left, right) => (GRADE_RANK[right.grade] ?? -1) - (GRADE_RANK[left.grade] ?? -1))[0]?.grade ?? "—";
}

function formatLastCycle(timestamp: number | null | undefined): string {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : "No cycle";
}

function getForexMarketStatus(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const hour = now.getUTCHours();
  if (day === 0 || day === 6) {
    return "Weekend";
  }
  return hour >= 0 && hour < 21 ? "Live" : "Closed";
}

function getStocksMarketStatus(): string {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) {
    return "Weekend";
  }
  return Object.values(MARKET_HOURS).some(hours => {
    const hour = now.getUTCHours();
    return hour >= hours.open && hour < hours.close;
  })
    ? "Live"
    : "Closed";
}

function getCommoditiesMarketStatus(): string {
  const day = new Date().getUTCDay();
  return day === 0 || day === 6 ? "Weekend" : "Live";
}

function getIndicesMarketStatus(): string {
  const day = new Date().getUTCDay();
  if (day === 0 || day === 6) {
    return "Weekend";
  }
  return INDICES_SYMBOLS.some(symbol => isIndexMarketOpen(symbol)) ? "Live" : "Closed";
}

function resolveModuleStatus(
  enabled: boolean,
  providerStatus:
    | "ready"
    | "healthy"
    | "degraded"
    | "broken"
    | "degraded_stooq_fallback"
    | "degraded_yahoo_fallback"
    | "degraded_cached"
    | "healthy_stooq"
    | "no_data"
    | "plan_upgrade_required"
    | "not_configured"
    | undefined,
  liveStatus: string,
): string {
  if (!enabled || providerStatus === "not_configured") {
    return "Disabled";
  }
  if (providerStatus === "plan_upgrade_required") {
    return "Upgrade";
  }
  if (providerStatus === "degraded") {
    return "Degraded";
  }
  if (providerStatus === "broken") {
    return "Broken";
  }
  if (
    providerStatus === "degraded_stooq_fallback"
    || providerStatus === "degraded_yahoo_fallback"
    || providerStatus === "degraded_cached"
  ) {
    return "Degraded";
  }
  if (providerStatus === "no_data") {
    return "No Data";
  }
  return liveStatus;
}

export async function MarketsPage() {
  const [status, forex, crypto, stocks, commodities, indices, memecoins] = await Promise.all([
    getSystemStatusData(),
    getSignalsPageData(),
    getCryptoPageData(),
    getStocksPageData(),
    getCommoditiesPageData(),
    getIndicesPageData(),
    getMemePageData(),
  ]);

  const marketCards = [
    {
      label: "Forex",
      href: "/forex",
      count: `${forex.liveMarketBoard.length} pairs`,
      bestGrade: bestGrade([...forex.executable, ...forex.monitored]),
      executable: forex.executable.length,
      status: getForexMarketStatus(),
      lastCycle: formatLastCycle(forex.generatedAt),
    },
    {
      label: "Crypto",
      href: "/crypto",
      count: `${crypto.liveMarketBoard.length} pairs`,
      bestGrade: bestGrade([...crypto.executable, ...crypto.monitored]),
      executable: crypto.executable.length,
      status: "Live",
      lastCycle: formatLastCycle(crypto.lastCycleAt),
    },
    {
      label: "Stocks",
      href: "/stocks",
      count: `${ALL_STOCK_SYMBOLS.length} syms`,
      bestGrade: bestGrade([...stocks.executable, ...stocks.monitored]),
      executable: stocks.executable.length,
      status: resolveModuleStatus(stocks.enabled, stocks.providerStatus, getStocksMarketStatus()),
      lastCycle: formatLastCycle(stocks.lastCycleAt),
      note: stocks.providerNotice ?? undefined,
    },
    {
      label: "Commodities",
      href: "/commodities",
      count: `${ALL_COMMODITY_SYMBOLS.length} syms`,
      bestGrade: bestGrade([...commodities.executable, ...commodities.monitored]),
      executable: commodities.executable.length,
      status: resolveModuleStatus(commodities.enabled, commodities.providerStatus, getCommoditiesMarketStatus()),
      lastCycle: formatLastCycle(commodities.lastCycleAt),
      note: commodities.providerNotice ?? undefined,
    },
    {
      label: "Indices",
      href: "/indices",
      count: `${INDICES_SYMBOLS.length} syms`,
      bestGrade: bestGrade([...indices.executable, ...indices.monitored]),
      executable: indices.executable.length,
      status: resolveModuleStatus(indices.enabled, indices.providerStatus, getIndicesMarketStatus()),
      lastCycle: formatLastCycle(indices.lastCycleAt),
      note: indices.providerNotice ?? "Global benchmark regime coverage",
    },
    {
      label: "Meme Coins",
      href: "/memecoins",
      count: `${memecoins.universeSize || 4} coins`,
      bestGrade: bestGrade(memecoins.cards),
      executable: memecoins.executable.length,
      status: "Live 24/7",
      lastCycle: formatLastCycle(memecoins.lastCycleAt),
      note: memecoins.lastDiscoveryAt
        // eslint-disable-next-line react-hooks/purity -- wall-clock age is computed once per RSC request
        ? `Updated ${Math.round((Date.now() - memecoins.lastDiscoveryAt) / 3_600_000)}h ago`
        : "Discovery pending",
    },
  ];

  return (
    <ApexShell
      title="Markets"
      subtitle="Unified market map across forex, crypto, stocks, commodities, indices, and the dynamic meme-coin universe."
      mode={status.mode}
    >
      <section className="grid gap-4 xl:grid-cols-3">
        {marketCards.map(card => (
          <Link
            key={card.label}
            href={card.href}
            className="apex-surface block px-5 py-5 transition hover:border-[var(--apex-border-default)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">{card.label}</p>
                <p className="mt-2 font-[var(--apex-font-body)] text-[18px] font-semibold text-[var(--apex-text-primary)]">{card.count}</p>
              </div>
              <Chip
                label={card.status}
                variant={
                  card.status === "Live"
                    ? "active"
                    : card.status === "Closed"
                      || card.status === "Weekend"
                      || card.status === "Upgrade"
                      || card.status === "Degraded"
                      || card.status === "Broken"
                      || card.status === "No Data"
                      ? "watchlist"
                      : "neutral"
                }
              />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div>
                <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Best Grade</p>
                <p className="mt-2 text-[16px] text-[var(--apex-text-primary)]">{card.bestGrade}</p>
              </div>
              <div>
                <p className="font-[var(--apex-font-mono)] text-[9px] uppercase tracking-[0.12em] text-[var(--apex-text-tertiary)]">Executable</p>
                <p className="mt-2 text-[16px] text-[var(--apex-text-primary)]">{card.executable}</p>
              </div>
            </div>

            <p className="mt-4 text-[12px] text-[var(--apex-text-secondary)]">Last cycle: {card.lastCycle}</p>
            {"note" in card && card.note ? (
              <p className="mt-1 text-[12px] text-[var(--apex-text-tertiary)]">{card.note}</p>
            ) : null}
          </Link>
        ))}
      </section>
    </ApexShell>
  );
}
