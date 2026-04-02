import { prisma } from "@/src/infrastructure/db/prisma";
import { TelegramNotifier } from "@/src/lib/telegram";
import type { ScoredMemeScannerCoin } from "@/src/assets/memecoins/types";

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  });
}

export async function checkAndSendMemeAlerts(coins: ScoredMemeScannerCoin[]): Promise<number> {
  const notifier = new TelegramNotifier();
  if (!notifier.isConfigured()) {
    return 0;
  }

  let alertsSent = 0;
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);

  const alertWorthy = coins.filter(coin => {
    const isUltraEarly = coin.marketCap < 500_000;
    const hasVolumeSpike = coin.volume24h > 0 && coin.volume1h > coin.volume24h * 0.3;
    const hasGoodLiquidity = coin.liquidity > 10_000;
    const hasHighScore = coin.apexScore >= 75;
    const score = [isUltraEarly, hasVolumeSpike, hasGoodLiquidity, hasHighScore].filter(Boolean).length;
    return score >= 3;
  });

  for (const coin of alertWorthy) {
    const alertSignalId = `meme:${coin.contractAddress}`;
    const existing = await prisma.alertDeliveryAttempt.findFirst({
      where: {
        channel: "telegram",
        alertId: `signal:${alertSignalId}`,
        status: "success",
        attemptedAt: {
          gte: sixHoursAgo,
        },
      },
      orderBy: {
        attemptedAt: "desc",
      },
    });

    if (existing) {
      continue;
    }

    const message = [
      "APEX MEME ALERT",
      `${coin.name} (${coin.symbol}) on ${coin.chain.toUpperCase()}`,
      "",
      `APEX Score: ${coin.apexScore}/100 [${coin.grade}]`,
      `Market Cap: $${formatNumber(coin.marketCap)}`,
      `Liquidity: $${formatNumber(coin.liquidity)}`,
      `1h Volume: $${formatNumber(coin.volume1h)}`,
      `Holders: ${formatNumber(coin.holders)}`,
      `Signal: ${coin.signal}`,
      "",
      coin.reasoning,
      ...(coin.dexUrl ? ["", coin.dexUrl] : []),
    ].join("\n");

    const sent = await notifier.sendMessage(message, {
      signalId: alertSignalId,
      messageType: "meme_scanner",
    });
    if (sent) {
      alertsSent += 1;
    }
  }

  return alertsSent;
}
