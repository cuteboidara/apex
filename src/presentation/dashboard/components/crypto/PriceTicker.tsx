"use client";

type CryptoAsset = {
  symbol: string;
  label: string;
  short: string;
  tv: string;
};

type CryptoPriceRow = {
  symbol: string;
  label: string;
  short: string;
  price: number | null;
  change24h: number | null;
  changePct24h: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24h: number | null;
  marketCap?: number | null;
  direction: "up" | "down" | "flat";
  provider: "binance" | "coingecko";
  freshAt: number;
  stale?: boolean;
  reason?: string | null;
};

function formatPrice(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1000) return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(2);
  return value.toFixed(4);
}

function tone(direction: "up" | "down" | "flat"): string {
  if (direction === "up") return "text-[var(--apex-status-active-text)]";
  if (direction === "down") return "text-[#F87171]";
  return "text-[var(--apex-text-secondary)]";
}

export function PriceTicker({ assets, prices }: { assets: CryptoAsset[]; prices: CryptoPriceRow[] }) {
  const priceMap = new Map(prices.map(price => [price.symbol, price]));
  const items = assets.map(asset => ({
    asset,
    price: priceMap.get(asset.symbol) ?? null,
  }));

  return (
    <section className="apex-surface overflow-hidden px-0 py-3">
      <div className="ticker-wrap">
        <div className="ticker-track">
          {[...items, ...items].map((item, index) => (
            <div
              key={`${item.asset.symbol}-${index}`}
              className="ticker-item font-[var(--apex-font-mono)] text-[12px]"
            >
              <span className="text-[var(--apex-text-primary)]">{item.asset.short}</span>
              {" "}
              <span className="text-[var(--apex-text-primary)]">${formatPrice(item.price?.price ?? null)}</span>
              {" "}
              <span className={tone(item.price?.direction ?? "flat")}>
                {item.price?.direction === "up" ? "▲" : item.price?.direction === "down" ? "▼" : "•"}
                {" "}
                {item.price?.changePct24h != null
                  ? `${item.price.changePct24h >= 0 ? "+" : ""}${item.price.changePct24h.toFixed(2)}%`
                  : "—"}
              </span>
            </div>
          ))}
        </div>
      </div>
      <style jsx>{`
        .ticker-wrap {
          overflow: hidden;
          width: 100%;
        }
        .ticker-track {
          display: flex;
          width: max-content;
          animation: ticker-scroll 32s linear infinite;
        }
        .ticker-track:hover {
          animation-play-state: paused;
        }
        .ticker-item {
          padding: 0 1.5rem;
          white-space: nowrap;
        }
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  );
}
