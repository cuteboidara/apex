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

function formatPrice(value: number | null): string {
  return value == null ? "—" : value.toFixed(2);
}

function directionTone(direction: "up" | "down" | "flat"): string {
  if (direction === "up") return "text-[var(--apex-status-active-text)]";
  if (direction === "down") return "text-[#F87171]";
  return "text-[var(--apex-text-secondary)]";
}

function vixFearLabel(value: number | null): { label: string; tone: string } {
  if (value == null) {
    return {
      label: "Unavailable",
      tone: "text-[var(--apex-text-secondary)]",
    };
  }
  if (value < 15) {
    return { label: "Low Fear", tone: "text-[var(--apex-status-active-text)]" };
  }
  if (value < 25) {
    return { label: "Moderate", tone: "text-[#FCD34D]" };
  }
  if (value < 35) {
    return { label: "High Fear", tone: "text-[#FB923C]" };
  }
  return { label: "Extreme Fear", tone: "text-[#F87171]" };
}

export function DXYVIXWidget({ assets }: { assets: IndexPriceRow[] }) {
  const dxy = assets.find(asset => asset.symbol === "DX-Y.NYB") ?? null;
  const vix = assets.find(asset => asset.symbol === "^VIX") ?? null;
  const vixFear = vixFearLabel(vix?.price ?? null);

  const items = [
    {
      key: "dxy",
      title: "DXY",
      subtitle: "US Dollar Index",
      row: dxy,
      extraLabel: null,
      extraTone: "",
    },
    {
      key: "vix",
      title: "VIX",
      subtitle: "Volatility Index",
      row: vix,
      extraLabel: vixFear.label,
      extraTone: vixFear.tone,
    },
  ];

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      {items.map(item => (
        <article
          key={item.key}
          className="rounded-[var(--apex-radius-lg)] border border-[var(--apex-border-subtle)] bg-[var(--apex-bg-raised)] px-5 py-5"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-[var(--apex-font-mono)] text-[10px] uppercase tracking-[0.14em] text-[var(--apex-text-tertiary)]">
                {item.title}
              </p>
              <p className="mt-2 text-[15px] font-medium text-[var(--apex-text-primary)]">
                {item.subtitle}
              </p>
            </div>
            {item.extraLabel ? (
              <span className={`font-[var(--apex-font-mono)] text-[11px] uppercase tracking-[0.12em] ${item.extraTone}`}>
                {item.extraLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-5 font-[var(--apex-font-mono)] text-[28px] text-[var(--apex-text-primary)]">
            {formatPrice(item.row?.price ?? null)}
          </p>
          <p className={`mt-2 font-[var(--apex-font-mono)] text-[12px] ${directionTone(item.row?.direction ?? "flat")}`}>
            {item.row?.change != null ? `${item.row.change >= 0 ? "+" : ""}${item.row.change.toFixed(2)}` : "—"}
            {" · "}
            {item.row?.changePct != null ? `${item.row.changePct >= 0 ? "+" : ""}${item.row.changePct.toFixed(2)}%` : "—"}
          </p>
        </article>
      ))}
    </section>
  );
}
