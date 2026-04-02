import { TelegramNotifier } from "@/src/lib/telegram";

import type {
  DailySignalDeliveryPayload,
  NotificationChannel,
  NotificationChannelSendInput,
  NotificationChannelSendResult,
} from "./NotificationChannel";

function formatPrice(value: number | null): string {
  if (value == null) {
    return "n/a";
  }
  return value.toFixed(Math.abs(value) >= 1 ? 4 : 6);
}

function formatCardLine(card: DailySignalDeliveryPayload["publishableSignals"][number]): string {
  const direction = card.direction === "long" ? "LONG" : card.direction === "short" ? "SHORT" : "NEUTRAL";
  const tp1Rr = typeof card.tp1RiskReward === "number" && Number.isFinite(card.tp1RiskReward)
    ? ` (${card.tp1RiskReward.toFixed(2)}R)`
    : "";
  const tp2Rr = typeof card.tp2RiskReward === "number" && Number.isFinite(card.tp2RiskReward)
    ? ` (${card.tp2RiskReward.toFixed(2)}R)`
    : "";

  return [
    `- ${card.symbol} ${direction} ${card.grade}${card.entryTimeframe ? ` • ${card.entryTimeframe}` : ""}`,
    `  Entry ${formatPrice(card.entry)} | SL ${formatPrice(card.sl)} | TP1 ${formatPrice(card.tp1)}${tp1Rr} | TP2 ${formatPrice(card.tp2)}${tp2Rr}`,
    card.htfBiasSummary ? `  HTF: ${card.htfBiasSummary}` : null,
    card.liquiditySweepDescription ? `  Sweep: ${card.liquiditySweepDescription}` : null,
    typeof card.confluenceScore === "number" ? `  Confluence: ${Math.round(card.confluenceScore)}/100` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function formatSessionLabel(session: DailySignalDeliveryPayload["session"]): string {
  if (!session) {
    return "Unknown";
  }

  if (session === "new_york") {
    return "New York";
  }

  return session.charAt(0).toUpperCase() + session.slice(1);
}

function buildTelegramDigest(payload: DailySignalDeliveryPayload): string {
  const lines = [
    `APEX Daily Signals — ${formatSessionLabel(payload.session)} — ${payload.runDate}`,
    `Timezone: ${payload.timezone}`,
    `Floor: ${payload.minimumGrade}`,
    `Signals: ${payload.publishableSignals.length} publishable / ${payload.allSignalCount} total`,
  ];

  if (payload.zeroSignalDay || payload.publishableSignals.length === 0) {
    lines.push("No publishable signals met the daily floor.");
  } else {
    for (const card of payload.publishableSignals.slice(0, 5)) {
      lines.push(formatCardLine(card));
    }
  }

  if (payload.marketCommentary?.topOpportunity) {
    lines.push(`Top opportunity: ${payload.marketCommentary.topOpportunity}`);
  }

  if (payload.marketCommentary?.riskNote) {
    lines.push(`Risk note: ${payload.marketCommentary.riskNote}`);
  }

  return lines.join("\n");
}

export class TelegramNotificationChannel implements NotificationChannel {
  readonly channelId = "telegram";

  constructor(
    private readonly notifier = new TelegramNotifier(),
    private readonly target = process.env.TELEGRAM_CHAT_ID?.trim() ?? "",
  ) {}

  isEnabled(): boolean {
    return this.notifier.isConfigured();
  }

  getTarget(): string | null {
    return this.target || null;
  }

  async send(input: NotificationChannelSendInput): Promise<NotificationChannelSendResult> {
    const target = this.getTarget() ?? "telegram";

    if (input.dryRun) {
      return {
        status: "skipped",
        target,
        detail: "dry_run",
      };
    }

    if (!this.notifier.isConfigured()) {
      return {
        status: "failed",
        target,
        detail: "telegram_not_configured",
      };
    }

    const delivered = await this.notifier.sendMessage(buildTelegramDigest(input.payload));
    return delivered
      ? {
        status: "delivered",
        target,
        detail: input.explicitRetry ? "retry_delivered" : "delivered",
      }
      : {
        status: "failed",
        target,
        detail: "telegram_delivery_failed",
      };
  }
}
