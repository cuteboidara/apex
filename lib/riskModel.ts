export function calculateRiskRewardRatio(entry: number, stopLoss: number, takeProfit: number): number | null {
  const risk = Math.abs(entry - stopLoss);
  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }

  const reward = Math.abs(takeProfit - entry);
  if (!Number.isFinite(reward) || reward <= 0) {
    return null;
  }

  return Math.round((reward / risk) * 100) / 100;
}
