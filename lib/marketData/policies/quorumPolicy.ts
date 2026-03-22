import type { MarketStatus } from "@/lib/marketData/types";

export function rankStatus(status: MarketStatus): number {
  if (status === "LIVE") return 3;
  if (status === "DEGRADED") return 2;
  return 1;
}

type ComparableMarketResult = {
  marketStatus: MarketStatus;
  price?: number | null;
  timestamp?: number | null;
  candles?: Array<unknown>;
};

export function chooseBetter<T extends ComparableMarketResult>(left: T, right: T): T;
export function chooseBetter<T extends ComparableMarketResult>(left: T | null, right: T | null): T | null;
export function chooseBetter<T extends ComparableMarketResult>(left: T | null, right: T | null): T | null {
  if (!left) return right;
  if (!right) return left;
  const leftRank = rankStatus(left.marketStatus);
  const rightRank = rankStatus(right.marketStatus);
  if (leftRank !== rightRank) return leftRank > rightRank ? left : right;
  if ((left.price ?? 0) <= 0 && (right.price ?? 0) > 0) return right;
  if ((right.price ?? 0) <= 0 && (left.price ?? 0) > 0) return left;
  if ((left.candles?.length ?? 0) === 0 && (right.candles?.length ?? 0) > 0) return right;
  if ((right.candles?.length ?? 0) === 0 && (left.candles?.length ?? 0) > 0) return left;
  return (left.timestamp ?? 0) >= (right.timestamp ?? 0) ? left : right;
}
