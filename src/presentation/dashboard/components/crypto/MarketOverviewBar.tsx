"use client";

type MarketOverview = {
  totalMarketCap: number | null;
  totalVolume24h: number | null;
  btcDominance: number | null;
  ethDominance: number | null;
  marketCapChange24h: number | null;
  activeCryptos: number | null;
};

function formatCompactCurrency(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCompactNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function changeTone(value: number | null): string {
  if (value == null) return "text-[var(--apex-text-secondary)]";
  if (value > 0) return "text-[var(--apex-status-active-text)]";
  if (value < 0) return "text-[#F87171]";
  return "text-[var(--apex-text-secondary)]";
}

export function MarketOverviewBar({ overview }: { overview: MarketOverview | null }) {
  const stats = [
    {
      label: "Total Market Cap",
      value: formatCompactCurrency(overview?.totalMarketCap ?? null),
      subValue: overview?.marketCapChange24h != null
        ? `${overview.marketCapChange24h >= 0 ? "+" : ""}${overview.marketCapChange24h.toFixed(2)}%`
        : null,
      subTone: changeTone(overview?.marketCapChange24h ?? null),
    },
    {
      label: "24h Volume",
      value: formatCompactCurrency(overview?.totalVolume24h ?? null),
      subValue: null,
      subTone: "text-[var(--apex-text-secondary)]",
    },
    {
      label: "BTC Dominance",
      value: overview?.btcDominance != null ? `${overview.btcDominance.toFixed(1)}%` : "—",
      subValue: null,
      subTone: "text-[var(--apex-text-secondary)]",
    },
    {
      label: "ETH Dominance",
      value: overview?.ethDominance != null ? `${overview.ethDominance.toFixed(1)}%` : "—",
      subValue: null,
      subTone: "text-[var(--apex-text-secondary)]",
    },
    {
      label: "Active Cryptos",
      value: formatCompactNumber(overview?.activeCryptos ?? null),
      subValue: null,
      subTone: "text-[var(--apex-text-secondary)]",
    },
  ];

  return (
    <section className="apex-surface px-6 py-5">
      <div className="grid gap-4 lg:grid-cols-5">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className={`flex flex-col gap-2 ${index < stats.length - 1 ? "lg:border-r lg:border-[var(--apex-border-subtle)] lg:pr-4" : ""}`}
          >
            <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
              {stat.label}
            </p>
            <p className="font-[var(--apex-font-mono)] text-[20px] text-[var(--apex-text-primary)]">
              {stat.value}
            </p>
            {stat.subValue ? (
              <p className={`text-[12px] ${stat.subTone}`}>
                {stat.subValue}
              </p>
            ) : (
              <span className="h-[18px]" />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
