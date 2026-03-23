export type PositionDirection = "LONG" | "SHORT";

export function calculatePositionPnl(
  direction: PositionDirection,
  entryPrice: number,
  currentPrice: number,
  quantity: number
) {
  const move = direction === "LONG" ? currentPrice - entryPrice : entryPrice - currentPrice;
  return move * quantity;
}

export function calculateRiskBasedQuantity(input: {
  accountEquity: number;
  riskFraction?: number;
  entryPrice: number;
  stopLoss?: number | null;
  fallbackNotionalFraction?: number;
}) {
  const riskFraction = input.riskFraction ?? 0.01;
  const fallbackNotionalFraction = input.fallbackNotionalFraction ?? 0.1;
  const stopDistance = input.stopLoss != null ? Math.abs(input.entryPrice - input.stopLoss) : 0;

  if (stopDistance > 0) {
    const riskBudget = input.accountEquity * riskFraction;
    return Math.max(riskBudget / stopDistance, 0);
  }

  const notionalBudget = input.accountEquity * fallbackNotionalFraction;
  return input.entryPrice > 0 ? Math.max(notionalBudget / input.entryPrice, 0) : 0;
}

export function applyExecutionFriction(input: {
  price: number;
  direction: PositionDirection;
  side: "ENTRY" | "EXIT";
  spreadBps?: number;
  slippageBps?: number;
}) {
  const bps = ((input.spreadBps ?? 0) + (input.slippageBps ?? 0)) / 10_000;
  const friction = input.price * bps;

  if (input.side === "ENTRY") {
    return input.direction === "LONG" ? input.price + friction : input.price - friction;
  }
  return input.direction === "LONG" ? input.price - friction : input.price + friction;
}
