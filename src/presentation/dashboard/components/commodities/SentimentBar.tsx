type CommodityCategory = "metals" | "energy";

type CommodityPriceRow = {
  symbol: string;
  label: string;
  category: CommodityCategory;
  unit: string;
  price: number | null;
  change: number | null;
  changePct: number | null;
  direction: "up" | "down" | "flat";
  high: number | null;
  low: number | null;
  volume: number | null;
  provider: string;
  freshAt: number;
  stale?: boolean;
  reason?: string | null;
};

const SENTIMENT_GROUPS: Array<{
  key: CommodityCategory;
  label: string;
  icon: string;
}> = [
  { key: "metals", label: "Metals", icon: "⚒" },
  { key: "energy", label: "Energy", icon: "⚡" },
];

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sentimentTone(changePct: number) {
  if (changePct > 0.15) {
    return {
      label: "BULLISH",
      className: "border-[rgba(80,160,100,0.35)] bg-[rgba(80,160,100,0.10)] text-[var(--apex-status-active-text)]",
    };
  }
  if (changePct < -0.15) {
    return {
      label: "BEARISH",
      className: "border-[rgba(239,68,68,0.30)] bg-[rgba(239,68,68,0.10)] text-[#F87171]",
    };
  }
  return {
    label: "NEUTRAL",
    className: "border-[var(--apex-border-subtle)] bg-[rgba(255,255,255,0.03)] text-[var(--apex-text-secondary)]",
  };
}

export function SentimentBar({ assets }: { assets: CommodityPriceRow[] }) {
  return (
    <section className="apex-surface px-6 py-5">
      <div className="mb-5 border-b border-[var(--apex-border-subtle)] pb-4">
        <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
          Market Sentiment
        </p>
        <p className="mt-2 text-[13px] text-[var(--apex-text-secondary)]">
          Category-level pressure across the commodity board using the latest live percentage changes.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {SENTIMENT_GROUPS.map(group => {
          const rows = assets.filter(asset => asset.category === group.key);
          const changes = rows
            .map(asset => asset.changePct)
            .filter((value): value is number => value != null && Number.isFinite(value));
          const avgChange = average(changes);
          const upCount = rows.filter(asset => asset.direction === "up").length;
          const downCount = rows.filter(asset => asset.direction === "down").length;
          const tone = sentimentTone(avgChange);

          return (
            <article
              key={group.key}
              className={`rounded-[var(--apex-radius-lg)] border px-4 py-4 ${tone.className}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em]">
                    {group.icon} {group.label}
                  </p>
                  <p className="mt-2 text-[15px] font-medium">{tone.label}</p>
                </div>
                <p className="font-[var(--apex-font-mono)] text-[14px]">
                  {avgChange >= 0 ? "+" : ""}{avgChange.toFixed(2)}%
                </p>
              </div>

              <p className="mt-4 text-[12px] opacity-80">
                {upCount}↑ {downCount}↓
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
