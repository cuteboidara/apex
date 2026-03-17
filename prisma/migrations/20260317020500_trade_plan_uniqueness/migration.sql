WITH ranked_trade_plans AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "signalId", style
      ORDER BY "createdAt" DESC, id DESC
    ) AS row_num
  FROM "TradePlan"
)
DELETE FROM "TradePlan"
WHERE id IN (
  SELECT id
  FROM ranked_trade_plans
  WHERE row_num > 1
);

CREATE UNIQUE INDEX "TradePlan_signalId_style_key" ON "TradePlan"("signalId", "style");
