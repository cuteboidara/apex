"use client";

type StockSector = "tech" | "finance" | "energy";

type StockPriceRow = {
  symbol: string;
  label: string;
  sector: StockSector;
  price: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap?: number | null;
  provider: string;
  freshAt: number;
  marketStatus: "open" | "closed" | "pre" | "after";
  stale?: boolean;
  reason?: string | null;
};

const SECTORS: Array<{ key: StockSector; label: string }> = [
  { key: "tech", label: "Tech" },
  { key: "finance", label: "Finance" },
  { key: "energy", label: "Energy" },
];

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
  if (value > 0.1) {
    return "Bullish";
  }
  if (value < -0.1) {
    return "Bearish";
  }
  return "Neutral";
}

export function SectorSentimentBar({ assets }: { assets: StockPriceRow[] }) {
  return (
    <section className="grid gap-4 lg:grid-cols-3">
      {SECTORS.map(sector => {
        const rows = assets.filter(asset => asset.sector === sector.key);
        const changes = rows
          .map(row => row.changePct)
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        const average = changes.length > 0
          ? changes.reduce((sum, value) => sum + value, 0) / changes.length
          : 0;
        const upCount = rows.filter(row => row.direction === "up").length;
        const downCount = rows.filter(row => row.direction === "down").length;

        return (
          <article
            key={sector.key}
            className={`rounded-[var(--apex-radius-lg)] border px-5 py-4 ${sentimentTone(average)}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em]">
                  {sector.label}
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
              {upCount}↑ {downCount}↓
            </p>
          </article>
        );
      })}
    </section>
  );
}
