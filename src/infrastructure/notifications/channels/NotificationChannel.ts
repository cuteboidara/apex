import type { DailySignalSession } from "@/src/infrastructure/config/dailySignals";
import type { TraderDashboardSignal, TraderMarketCommentary } from "@/src/lib/traderContracts";

export type DailySignalDeliveryPayload = {
  runId: string;
  windowKey: string;
  runDate: string;
  session: DailySignalSession | null;
  timezone: string;
  generatedAt: number;
  dryRun: boolean;
  zeroSignalDay: boolean;
  minimumGrade: string;
  allSignalCount: number;
  publishableSignals: TraderDashboardSignal[];
  marketCommentary: TraderMarketCommentary | null;
};

export type NotificationChannelSendInput = {
  deliveryId: string;
  payload: DailySignalDeliveryPayload;
  dryRun: boolean;
  explicitRetry: boolean;
};

export type NotificationChannelSendResult = {
  status: "delivered" | "failed" | "skipped";
  target: string;
  providerMessageId?: string | null;
  detail?: string | null;
};

export interface NotificationChannel {
  readonly channelId: string;
  isEnabled(): boolean | Promise<boolean>;
  getTarget(): string | null;
  send(input: NotificationChannelSendInput): Promise<NotificationChannelSendResult>;
}
