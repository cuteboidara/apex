"use client";

type IndexRegion = "us" | "europe" | "asia";

type IndexPriceRow = {
  symbol: string;
  label: string;
  region: IndexRegion;
  price: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  high: number | null;
  low: number | null;
  provider: string;
  freshAt: number;
  marketStatus: "open" | "closed";
  stale?: boolean;
  reason?: string | null;
};

const REGIONS = [
  { key: "us", label: "Americas" },
  { key: "europe", label: "Europe" },
  { key: "asia", label: "Asia-Pacific" },
] as const;

function sentimentTone(value: number): string {
  if (value > 0.1) {
    return "border-[rgba(80,160,100,0.35)] bg-[rgba(80,160,100,0.10)] text-[var(--apex-status-active-text)]";
  }
  if (value < -0.1) {
    return "border-[rgba(239,68,68,0.28)] bg-[rgba(239,68,68,0.10)] text-[#F87171]";
  }
  return "border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.03)] text-[var(--apex-text-secondary)]";
}

function sentimentLabel(value: number): string {
  if (value > 0.1) return "Bullish";
  if (value < -0.1) return "Bearish";
  return "Neutral";
}

export function GlobalMarketOverview({ assets }: { assets: IndexPriceRow[] }) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      {REGIONS.map(region => {
        const rows = assets.filter(asset => asset.region === region.key);
        const changes = rows
          .map(row => row.changePct)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        const average = changes.length > 0
          ? changes.reduce((sum, value) => sum + value, 0) / changes.length
          : 0;
        const openCount = rows.filter(row => row.marketStatus === "open").length;

        return (
          <article
            key={region.key}
            className={`rounded-[var(--apex-radius-lg)] border px-5 py-4 ${sentimentTone(average)}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em]">
                  {region.label}
                </p>
                <p className="mt-2 text-[15px] font-medium">
                  {sentimentLabel(average)}
                </p>
              </div>
              <p className="font-[var(--apex-font-mono)] text-[20px]">
                {average >= 0 ? "+" : ""}{average.toFixed(2)}%
              </p>
            </div>
            <p className="mt-3 text-[12px] opacity-80">
              {openCount}/{rows.length} markets open
            </p>
          </article>
        );
      })}
    </section>
  );
}
