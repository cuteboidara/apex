import type { AllocationIntent, RiskDecision, RecoveryMode } from "@/src/interfaces/contracts";
import type { CryptoSignalCard } from "@/src/crypto/types";
import { prisma } from "@/src/infrastructure/db/prisma";
import { createId } from "@/src/lib/ids";
import { logger } from "@/src/lib/logger";
import { formatSystemModeLabel } from "@/src/lib/operatorControls";
import { getTelegramConfig } from "@/src/lib/operatorSettings";
import type { SignalLevels } from "@/src/lib/signalLevels";
import { formatTraderTelegramSignal, gradeMeetsMinimum, shouldSendTraderTelegramSignal } from "@/src/lib/trader";
import { TRADER_SIGNAL_GRADES, type TraderOperatorPreferences, type TraderDashboardSignal, type TraderSignalGrade } from "@/src/lib/traderContracts";

type CycleSummaryRow = {
  symbol: string;
  action: string;
  confidence: number;
  pods: string[];
};

type CycleSummaryInput = {
  cycleId: string;
  timestamp: string;
  mode: RecoveryMode;
  status: "completed" | "failed" | "skipped";
  rows: CycleSummaryRow[];
  approvedCount: number;
  rejectedCount: number;
  drawdownPct: number;
  fills: number;
  avgSlippageBps: number;
  failureReason?: string;
};

type TelegramSendContext = {
  signalId?: string | null;
  messageType?: string;
  recipient?: string;
};

type TelegramApiResponse = {
  ok?: boolean;
  result?: {
    message_id?: number;
  };
  description?: string;
};

type TelegramMarketSignalCard = {
  id: string;
  signal_id: string | null;
  marketSymbol?: string;
  displayName: string;
  direction: "buy" | "sell" | "neutral";
  grade: string;
  status: string;
  displayCategory?: string;
  livePrice: number | null;
  entry: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  setupType: string;
  shortReasoning: string;
  marketStateLabels: readonly string[];
  noTradeReason: string | null;
  confidence?: number;
  session?: string | null;
  entryTimeframe?: string | null;
  tp1RiskReward?: number | null;
  tp2RiskReward?: number | null;
  htfBiasSummary?: string | null;
  liquiditySweepDescription?: string | null;
  confluenceScore?: number | null;
  ui_sections?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function formatTelegramPrice(value: number | null): string {
  if (value == null) {
    return "n/a";
  }

  if (Math.abs(value) >= 1000) {
    return value.toFixed(2);
  }

  if (Math.abs(value) >= 1) {
    return value.toFixed(4);
  }

  return value.toFixed(6);
}

function deriveRiskReward(card: TelegramMarketSignalCard): number | null {
  if (card.entry == null || card.sl == null || card.tp1 == null) {
    return null;
  }

  const risk = Math.abs(card.entry - card.sl);
  if (!Number.isFinite(risk) || risk <= 0) {
    return null;
  }

  const reward = Math.abs(card.tp1 - card.entry);
  if (!Number.isFinite(reward) || reward <= 0) {
    return null;
  }

  return reward / risk;
}

function formatConfidence(confidence: number | undefined): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return null;
  }

  const normalized = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(normalized)}%`;
}

function readTopDownContext(card: TelegramMarketSignalCard): {
  entryTimeframe: string | null;
  tp1RiskReward: number | null;
  tp2RiskReward: number | null;
  htfBiasSummary: string | null;
  liquiditySweepDescription: string | null;
  confluenceScore: number | null;
  autoAlert: boolean | null;
} | null {
  const sections = asRecord(card.ui_sections);
  const topDown = asRecord(sections.topDown);

  const entryTimeframe = typeof topDown.entryTimeframe === "string"
    ? topDown.entryTimeframe
    : typeof card.entryTimeframe === "string"
      ? card.entryTimeframe
      : null;
  const tp1RiskReward = typeof topDown.tp1RiskReward === "number" && Number.isFinite(topDown.tp1RiskReward)
    ? topDown.tp1RiskReward
    : typeof card.tp1RiskReward === "number" && Number.isFinite(card.tp1RiskReward)
      ? card.tp1RiskReward
      : null;
  const tp2RiskReward = typeof topDown.tp2RiskReward === "number" && Number.isFinite(topDown.tp2RiskReward)
    ? topDown.tp2RiskReward
    : typeof card.tp2RiskReward === "number" && Number.isFinite(card.tp2RiskReward)
      ? card.tp2RiskReward
      : null;
  const htfBiasSummary = typeof topDown.htfBiasSummary === "string"
    ? topDown.htfBiasSummary
    : typeof card.htfBiasSummary === "string"
      ? card.htfBiasSummary
      : null;
  const liquiditySweepDescription = typeof topDown.liquiditySweepDescription === "string"
    ? topDown.liquiditySweepDescription
    : typeof card.liquiditySweepDescription === "string"
      ? card.liquiditySweepDescription
      : null;
  const confluenceScore = typeof topDown.confluenceScore === "number" && Number.isFinite(topDown.confluenceScore)
    ? topDown.confluenceScore
    : typeof card.confluenceScore === "number" && Number.isFinite(card.confluenceScore)
      ? card.confluenceScore
      : null;
  const autoAlert = typeof topDown.autoAlert === "boolean" ? topDown.autoAlert : null;

  if (
    entryTimeframe == null
    && tp1RiskReward == null
    && tp2RiskReward == null
    && htfBiasSummary == null
    && liquiditySweepDescription == null
    && confluenceScore == null
    && autoAlert == null
  ) {
    return null;
  }

  return {
    entryTimeframe,
    tp1RiskReward,
    tp2RiskReward,
    htfBiasSummary,
    liquiditySweepDescription,
    confluenceScore,
    autoAlert,
  };
}

function readMtfContext(card: TelegramMarketSignalCard): {
  monthlyBias: string | null;
  weeklyBias: string | null;
  dailyBias: string | null;
  h4Bias: string | null;
  h1Bias: string | null;
  entryTrigger: string | null;
  priceZone: string | null;
  riskReward: number | null;
} | null {
  const sections = asRecord(card.ui_sections);
  const mtf = asRecord(sections.mtf);
  if (Object.keys(mtf).length === 0) {
    return null;
  }

  const premiumDiscount = asRecord(mtf.premiumDiscount);
  return {
    monthlyBias: typeof mtf.monthlyBias === "string" ? mtf.monthlyBias : null,
    weeklyBias: typeof mtf.weeklyBias === "string" ? mtf.weeklyBias : null,
    dailyBias: typeof mtf.dailyBias === "string" ? mtf.dailyBias : null,
    h4Bias: typeof mtf.h4Bias === "string" ? mtf.h4Bias : null,
    h1Bias: typeof mtf.h1Bias === "string" ? mtf.h1Bias : null,
    entryTrigger: typeof mtf.entryTrigger === "string" ? mtf.entryTrigger.replaceAll("_", " ") : null,
    priceZone: typeof premiumDiscount.zone === "string" ? premiumDiscount.zone : null,
    riskReward: typeof mtf.riskReward === "number" && Number.isFinite(mtf.riskReward) ? mtf.riskReward : null,
  };
}

function readCommodityContext(card: TelegramMarketSignalCard): {
  category: string | null;
  weeklyBias: string | null;
  dailyBias: string | null;
  h4Bias: string | null;
  seasonal: string | null;
  dxyContext: string | null;
  entryTrigger: string | null;
  riskReward: number | null;
} | null {
  const sections = asRecord(card.ui_sections);
  const macro = asRecord(sections.commodityMacro);
  if (Object.keys(macro).length === 0) {
    return null;
  }

  return {
    category: typeof macro.category === "string" ? macro.category : null,
    weeklyBias: typeof macro.weeklyBias === "string" ? macro.weeklyBias : null,
    dailyBias: typeof macro.dailyBias === "string" ? macro.dailyBias : null,
    h4Bias: typeof macro.h4Bias === "string" ? macro.h4Bias : null,
    seasonal: typeof macro.seasonal === "string" ? macro.seasonal : null,
    dxyContext: typeof macro.dxyContext === "string" ? macro.dxyContext : null,
    entryTrigger: typeof macro.entryTrigger === "string" ? macro.entryTrigger.replaceAll("_", " ") : null,
    riskReward: typeof macro.riskReward === "number" && Number.isFinite(macro.riskReward) ? macro.riskReward : null,
  };
}

export function shouldSendMarketCardTelegramSignal(
  card: TelegramMarketSignalCard,
  preferences: Pick<TraderOperatorPreferences, "minimumTelegramGrade" | "includeBTelegramSignals">,
): boolean {
  if (card.direction === "neutral") {
    return false;
  }

  if (["blocked", "invalidated", "expired"].includes(card.status)) {
    return false;
  }

  if (card.displayCategory === "rejected") {
    return false;
  }

  const grade = TRADER_SIGNAL_GRADES.includes(card.grade as TraderSignalGrade)
    ? card.grade as TraderSignalGrade
    : null;
  if (!grade || !gradeMeetsMinimum(grade, preferences.minimumTelegramGrade)) {
    return false;
  }

  const normalizedGrade = grade === "S+" ? "S" : grade;
  if (!["S", "A", "B"].includes(normalizedGrade)) {
    return false;
  }

  if (normalizedGrade === "B" && !preferences.includeBTelegramSignals) {
    return false;
  }

  const topDown = readTopDownContext(card);
  if (topDown?.autoAlert === false) {
    return false;
  }

  return true;
}

export function formatMarketCardTelegramSignal(card: TelegramMarketSignalCard, assetLabel: string): string {
  const symbol = card.marketSymbol ?? card.displayName;
  const mtf = readMtfContext(card);
  const commodity = readCommodityContext(card);
  const topDown = readTopDownContext(card);
  const confidence = formatConfidence(card.confidence);
  const riskReward = topDown?.tp1RiskReward ?? commodity?.riskReward ?? mtf?.riskReward ?? deriveRiskReward(card);
  const riskLine = riskReward != null || confidence != null || topDown?.confluenceScore != null
    ? [
      riskReward != null ? `R:R ${riskReward.toFixed(2)}:1` : null,
      confidence != null ? `Confidence: ${confidence}` : null,
      topDown?.confluenceScore != null ? `Confluence: ${Math.round(topDown.confluenceScore)}/100` : null,
    ].filter((segment): segment is string => segment != null).join(" · ")
    : null;
  const isCommodityAlert = assetLabel.toLowerCase().includes("commodit") && commodity != null;
  const directionLabel = card.direction === "buy" ? "LONG" : card.direction === "sell" ? "SHORT" : "NEUTRAL";

  return [
    `APEX ${assetLabel.toUpperCase()} — ${card.displayName}`,
    "",
    `${symbol} • ${directionLabel} • ${card.grade}${isCommodityAlert && commodity?.category ? ` • ${commodity.category.toUpperCase()}` : ""}`,
    `Status: ${card.status.toUpperCase()} | Setup: ${card.setupType}`,
    "",
    topDown?.entryTimeframe ? `Entry confirmation: ${topDown.entryTimeframe}` : null,
    `Live price: ${formatTelegramPrice(card.livePrice)}`,
    `Entry: ${formatTelegramPrice(card.entry)} | SL: ${formatTelegramPrice(card.sl)}`,
    `TP1: ${formatTelegramPrice(card.tp1)}${topDown?.tp1RiskReward != null ? ` (${topDown.tp1RiskReward.toFixed(2)}R)` : ""}`,
    `TP2: ${formatTelegramPrice(card.tp2)}${topDown?.tp2RiskReward != null ? ` (${topDown.tp2RiskReward.toFixed(2)}R)` : ""}`,
    riskLine,
    topDown?.htfBiasSummary ? `HTF Bias: ${topDown.htfBiasSummary}` : null,
    topDown?.liquiditySweepDescription ? `Sweep: ${topDown.liquiditySweepDescription}` : null,
    isCommodityAlert ? "Timeframe Bias:" : null,
    isCommodityAlert ? `Weekly: ${commodity?.weeklyBias ?? "—"} · Daily: ${commodity?.dailyBias ?? "—"} · H4: ${commodity?.h4Bias ?? "—"}` : null,
    isCommodityAlert ? "Macro Context:" : null,
    isCommodityAlert ? `Seasonal: ${commodity?.seasonal ?? "—"} · DXY: ${commodity?.dxyContext ?? "—"}` : null,
    isCommodityAlert && commodity?.entryTrigger && commodity.entryTrigger !== "none" ? `Entry trigger: ${commodity.entryTrigger}` : null,
    mtf ? "Timeframe Bias:" : null,
    mtf ? `Monthly: ${mtf.monthlyBias ?? "—"} · Weekly: ${mtf.weeklyBias ?? "—"}` : null,
    mtf ? `Daily: ${mtf.dailyBias ?? "—"} · H4: ${mtf.h4Bias ?? "—"} · H1: ${mtf.h1Bias ?? "—"}` : null,
    mtf ? `Entry trigger: ${mtf.entryTrigger ?? "—"} · Price zone: ${mtf.priceZone ?? "—"}` : null,
    card.shortReasoning,
    card.marketStateLabels.length > 0 ? `Market: ${card.marketStateLabels.join(" · ")}` : null,
    card.noTradeReason ? `Note: ${card.noTradeReason}` : null,
    "",
    `— APEX Intelligence · ${assetLabel}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

export class TelegramNotifier {
  constructor(
    private readonly token = process.env.TELEGRAM_BOT_TOKEN ?? "",
    private readonly chatId = process.env.TELEGRAM_CHAT_ID ?? "",
    private readonly fallbackPreferences: Pick<TraderOperatorPreferences, "minimumTelegramGrade" | "includeBTelegramSignals"> = {
      minimumTelegramGrade: "B",
      includeBTelegramSignals: true,
    },
  ) {}

  private async resolveTraderPreferences(): Promise<Pick<TraderOperatorPreferences, "minimumTelegramGrade" | "includeBTelegramSignals">> {
    const dbConfig = await getTelegramConfig();
    return {
      minimumTelegramGrade: dbConfig.minGrade ?? this.fallbackPreferences.minimumTelegramGrade,
      includeBTelegramSignals: dbConfig.includeBGrade ?? this.fallbackPreferences.includeBTelegramSignals,
    };
  }

  isConfigured(): boolean {
    return Boolean(this.token && this.chatId);
  }

  private async recordDeliveryAttempt(input: {
    status: "success" | "failure";
    sentAt: Date;
    signalId?: string | null;
    recipient: string;
    messageType: string;
    providerResponse?: string | null;
    providerMessageId?: string | null;
    errorMessage?: string | null;
    latencyMs?: number | null;
  }): Promise<void> {
    try {
      await prisma.alertDeliveryAttempt.create({
        data: {
          alertId: input.signalId ? `signal:${input.signalId}` : createId("tgattempt"),
          channel: "telegram",
          recipient: input.recipient,
          status: input.status,
          latencyMs: input.latencyMs ?? undefined,
          providerMessageId: input.providerMessageId ?? undefined,
          providerResponse: input.providerResponse ?? undefined,
          detail: JSON.stringify({
            messageType: input.messageType,
            signalId: input.signalId ?? null,
            errorMessage: input.errorMessage ?? null,
            sentAt: input.sentAt.toISOString(),
          }),
          attemptedAt: input.sentAt,
        },
      });
    } catch (error) {
      logger.warn({
        module: "telegram",
        message: "Failed to persist telegram delivery attempt",
        error: String(error),
        signal_id: input.signalId ?? null,
        message_type: input.messageType,
      });
    }
  }

  async sendMessage(text: string, context: TelegramSendContext = {}): Promise<boolean> {
    const recipient = context.recipient || this.chatId || "UNCONFIGURED";

    if (!this.isConfigured()) {
      await this.recordDeliveryAttempt({
        status: "failure",
        sentAt: new Date(),
        signalId: context.signalId ?? null,
        recipient,
        messageType: context.messageType ?? "generic",
        errorMessage: "Telegram notifier not configured",
      });
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const startedAt = Date.now();

    try {
      const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
        }),
      });
      const responseText = await response.text();
      const sentAt = new Date();
      let parsed: TelegramApiResponse | null = null;

      try {
        parsed = responseText ? JSON.parse(responseText) as TelegramApiResponse : null;
      } catch {
        parsed = null;
      }

      if (!response.ok) {
        const errorMessage = parsed?.description ?? `HTTP ${response.status}`;
        logger.error({
          module: "telegram",
          message: "Telegram send failed",
          status: response.status,
          error: errorMessage,
          response_body: responseText,
          signal_id: context.signalId ?? null,
          message_type: context.messageType ?? "generic",
        });
        await this.recordDeliveryAttempt({
          status: "failure",
          sentAt,
          signalId: context.signalId ?? null,
          recipient,
          messageType: context.messageType ?? "generic",
          providerResponse: responseText,
          errorMessage,
          latencyMs: Date.now() - startedAt,
        });
        return false;
      }

      await this.recordDeliveryAttempt({
        status: "success",
        sentAt,
        signalId: context.signalId ?? null,
        recipient,
        messageType: context.messageType ?? "generic",
        providerResponse: responseText,
        providerMessageId: parsed?.result?.message_id != null ? String(parsed.result.message_id) : null,
        latencyMs: Date.now() - startedAt,
      });
      return true;
    } catch (error) {
      const sentAt = new Date();
      logger.error({
        module: "telegram",
        message: "Telegram send threw an exception",
        error: String(error),
        signal_id: context.signalId ?? null,
        message_type: context.messageType ?? "generic",
      });
      await this.recordDeliveryAttempt({
        status: "failure",
        sentAt,
        signalId: context.signalId ?? null,
        recipient,
        messageType: context.messageType ?? "generic",
        errorMessage: String(error),
        latencyMs: Date.now() - startedAt,
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async sendCycleSummary(summary: CycleSummaryInput): Promise<boolean> {
    const modeLabel = formatSystemModeLabel(summary.mode);
    const symbolLines = summary.rows.length
      ? summary.rows.map(
          row =>
            `${row.symbol}: ${row.action} | Conf: ${Math.round(row.confidence * 100)}%`,
        )
      : ["(no symbol actions this cycle)"];

    const body = [
      `📊 APEX Cycle — ${summary.timestamp}`,
      `Mode: ${modeLabel}`,
      summary.status !== "completed" ? `Status: ${summary.status}` : null,
      "───────────────────",
      ...symbolLines,
      "───────────────────",
      `Approved: ${summary.approvedCount} | Rejected: ${summary.rejectedCount}`,
      `Drawdown: ${summary.drawdownPct.toFixed(2)}%`,
      ...(summary.failureReason ? [`Failure: ${summary.failureReason}`] : []),
    ]
      .filter((line): line is string => line != null)
      .join("\n");

    return this.sendMessage(body, {
      messageType: "cycle_summary",
    });
  }

  async sendRiskAlert(input: {
    symbol: string;
    decision: RiskDecision;
    intent: AllocationIntent;
  }): Promise<boolean> {
    return this.sendMessage(
      [
        "APEX Risk Alert",
        `Symbol: ${input.symbol}`,
        `Status: ${input.decision.approval_status}`,
        `Direction: ${input.intent.direction}`,
        `Target: ${input.intent.target_position.toFixed(3)}`,
        `Entry style: ${input.intent.entry_style}`,
        `Vetoes: ${input.decision.veto_reasons.join(", ") || "none"}`,
        `Kill switch: ${input.decision.kill_switch_active ? "ACTIVE" : "inactive"}`,
        `Action: ${input.decision.de_risking_action ?? "none"}`,
      ].join("\n"),
      {
        messageType: "risk_alert",
      },
    );
  }

  async sendTraderSignalAlert(card: TraderDashboardSignal): Promise<boolean> {
    const preferences = await this.resolveTraderPreferences();
    if (!shouldSendTraderTelegramSignal(card, preferences)) {
      return false;
    }

    return this.sendMessage(formatTraderTelegramSignal(card), {
      signalId: card.latestLifecycle?.signal_id ?? null,
      messageType: "trader_signal",
    });
  }

  async sendCryptoSignalAlert(card: CryptoSignalCard): Promise<boolean> {
    const preferences = await this.resolveTraderPreferences();
    if (!shouldSendMarketCardTelegramSignal(card, preferences)) {
      return false;
    }

    return this.sendMessage(formatMarketCardTelegramSignal(card, "Crypto"), {
      signalId: card.signal_id ?? card.id,
      messageType: "crypto_signal",
    });
  }

  async sendMarketSignalAlerts(
    cards: TelegramMarketSignalCard[],
    input: {
      assetLabel: string;
      messageType: string;
    },
  ): Promise<number> {
    if (!this.isConfigured()) {
      return 0;
    }

    const preferences = await this.resolveTraderPreferences();
    let sentCount = 0;

    for (const card of cards) {
      if (!shouldSendMarketCardTelegramSignal(card, preferences)) {
        continue;
      }

      const sent = await this.sendMessage(
        formatMarketCardTelegramSignal(card, input.assetLabel),
        {
          signalId: card.signal_id ?? card.id,
          messageType: input.messageType,
        },
      );

      if (sent) {
        sentCount += 1;
      }
    }

    return sentCount;
  }

  async sendSignalAlert(input: {
    symbol: string;
    action: "long" | "short";
    confidence: number;
    regime: string;
    pods: string[];
    livePrice: number;
    levels: SignalLevels;
    timestamp: number;
  }): Promise<boolean> {
    return this.sendMessage(
      [
        "APEX Signal",
        `${input.symbol} | ${input.action.toUpperCase()} | ${Math.round(input.confidence * 100)}%`,
        `Live price: ${formatTelegramPrice(input.livePrice)}`,
        `Entry: ${formatTelegramPrice(input.levels.entry)}`,
        `Stop Loss: ${formatTelegramPrice(input.levels.stop_loss)}`,
        `TP1: ${formatTelegramPrice(input.levels.tp1)}`,
        `TP2: ${formatTelegramPrice(input.levels.tp2)}`,
        `TP3: ${formatTelegramPrice(input.levels.tp3)}`,
        `Regime: ${input.regime}`,
        `Pods: ${input.pods.join(", ")}`,
        `Time: ${new Date(input.timestamp).toISOString()}`,
      ].join("\n"),
      {
        messageType: "generic_signal",
      },
    );
  }
}
