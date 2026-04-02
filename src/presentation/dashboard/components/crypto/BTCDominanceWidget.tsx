"use client";

type MarketOverview = {
  totalMarketCap: number | null;
  totalVolume24h: number | null;
  btcDominance: number | null;
  ethDominance: number | null;
  marketCapChange24h: number | null;
  activeCryptos: number | null;
};

function segmentWidth(value: number | null, fallback = 0): string {
  const safe = value == null ? fallback : Math.max(0, Math.min(100, value));
  return `${safe}%`;
}

function arrow(current: number | null, previous: number | null): string {
  if (current == null || previous == null) return "•";
  if (current > previous) return "▲";
  if (current < previous) return "▼";
  return "•";
}

export function BTCDominanceWidget({
  overview,
  previousBtcDominance,
}: {
  overview: MarketOverview | null;
  previousBtcDominance: number | null;
}) {
  const btc = overview?.btcDominance ?? null;
  const eth = overview?.ethDominance ?? null;
  const other = btc != null && eth != null ? Math.max(0, 100 - btc - eth) : null;

  return (
    <section className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
            Dominance Split
          </p>
          <p className="mt-2 text-[14px] text-[var(--apex-text-secondary)]">
            BTC vs ETH vs Other
          </p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-[var(--apex-font-mono)] text-[34px] leading-none text-[var(--apex-text-primary)]">
              {btc != null ? `${btc.toFixed(1)}%` : "—"}
            </p>
            <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">
              BTC {arrow(btc, previousBtcDominance)}
            </p>
          </div>
          <div className="text-right text-[12px] text-[var(--apex-text-secondary)]">
            <p>ETH {eth != null ? `${eth.toFixed(1)}%` : "—"}</p>
            <p className="mt-1">Other {other != null ? `${other.toFixed(1)}%` : "—"}</p>
          </div>
        </div>

        <div className="mt-5 h-3 overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)]">
          <div className="flex h-full w-full">
            <div className="bg-[#F59E0B]" style={{ width: segmentWidth(btc) }} />
            <div className="bg-[#60A5FA]" style={{ width: segmentWidth(eth) }} />
            <div className="bg-[rgba(255,255,255,0.18)]" style={{ width: segmentWidth(other, 100) }} />
          </div>
        </div>
      </div>
    </section>
  );
}
