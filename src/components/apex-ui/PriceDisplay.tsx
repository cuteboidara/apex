"use client";

import { useEffect, useState } from "react";

import { formatTraderPrice } from "@/src/lib/trader";

type PriceSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<PriceSize, string> = {
  sm: "text-[13px]",
  md: "text-[18px]",
  lg: "text-[26px]",
};

export function PriceDisplay({
  price,
  size,
  className = "",
}: {
  price: number | null;
  size: PriceSize;
  className?: string;
}) {
  const [flash, setFlash] = useState(false);
  const [previous, setPrevious] = useState<number | null>(price);

  useEffect(() => {
    if (price != null && previous != null && price !== previous) {
      setFlash(true);
      const timeout = window.setTimeout(() => setFlash(false), 400);
      setPrevious(price);
      return () => window.clearTimeout(timeout);
    }

    setPrevious(price);
    return undefined;
  }, [price, previous]);

  const value = price == null ? "—" : formatTraderPrice(price);

  return (
    <span
      className={`font-[var(--apex-font-mono)] leading-none ${SIZE_CLASS[size]} ${flash ? "apex-price-flash" : ""} ${className}`.trim()}
      style={{
        color: price == null ? "var(--apex-grade-f)" : "var(--apex-text-accent)",
        fontFamily: "var(--apex-font-mono)",
      }}
    >
      {value}
    </span>
  );
}
