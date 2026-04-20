import { getSetting } from "@/src/lib/operatorSettings";
import {
  TRADING_SESSIONS,
  type TradingSession,
} from "@/src/config/marketScope";
import type { TraderSignalGrade } from "@/src/lib/traderContracts";
import { TRADER_SIGNAL_GRADES } from "@/src/lib/traderContracts";

export type DailySignalSession = TradingSession;
export type DailySignalSessionTimes = Record<DailySignalSession, string>;

export type DailySignalsConfig = {
  enabled: boolean;
  time: string;
  timezone: string;
  minimumGrade: TraderSignalGrade;
  telegramEnabled: boolean;
  sendZeroSignalSummary: boolean;
  sessionTimes: DailySignalSessionTimes;
};

export const DAILY_SIGNALS_SCHEDULE_WINDOW_MINUTES = 10;
export const DEFAULT_DAILY_SIGNAL_SESSION_TIMES: DailySignalSessionTimes = {
  asia: "00:00",
  london: "08:00",
  new_york: "13:00",
};

function normalizeBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeGrade(value: string | undefined, fallback: TraderSignalGrade): TraderSignalGrade {
  if (value && TRADER_SIGNAL_GRADES.includes(value as TraderSignalGrade)) {
    return value as TraderSignalGrade;
  }
  return fallback;
}

function normalizeTime(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : fallback;
}

function getLocalTimeParts(date: Date, timeZone: string): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(date);
  const hour = Number.parseInt(parts.find(part => part.type === "hour")?.value ?? "0", 10);
  const minute = Number.parseInt(parts.find(part => part.type === "minute")?.value ?? "0", 10);
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function getMinutesOfDay(date: Date, timeZone: string): number {
  const { hour, minute } = getLocalTimeParts(date, timeZone);
  return hour * 60 + minute;
}

function parseScheduledMinutes(time: string): number {
  const [hourPart = "0", minutePart = "0"] = time.split(":");
  const hour = Number.parseInt(hourPart, 10);
  const minute = Number.parseInt(minutePart, 10);
  return (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
}

export function getDailySignalDateKey(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find(part => part.type === "year")?.value ?? "0000";
  const month = parts.find(part => part.type === "month")?.value ?? "00";
  const day = parts.find(part => part.type === "day")?.value ?? "00";
  return `${year}-${month}-${day}`;
}

export function buildDailySignalBaseWindowKey(
  date: Date,
  timeZone: string,
  session: DailySignalSession,
): string {
  return `${getDailySignalDateKey(date, timeZone)}:${session}:${timeZone}`;
}

export function parseDailySignalBaseWindowKey(baseWindowKey: string): {
  runDate: string;
  session: DailySignalSession | null;
  timezone: string;
} {
  const [runDate = "", maybeSession = "", ...timezoneParts] = baseWindowKey.split(":");

  if ((TRADING_SESSIONS as readonly string[]).includes(maybeSession)) {
    return {
      runDate,
      session: maybeSession as DailySignalSession,
      timezone: timezoneParts.join(":"),
    };
  }

  return {
    runDate,
    session: null,
    timezone: [maybeSession, ...timezoneParts].filter(Boolean).join(":"),
  };
}

export function shouldRunNow(
  currentTime: Date,
  config: Pick<DailySignalsConfig, "enabled" | "time" | "timezone"> & {
    sessionTimes?: Partial<DailySignalSessionTimes>;
  },
  session?: DailySignalSession,
): boolean {
  if (!config.enabled) {
    return false;
  }

  const currentMinutes = getMinutesOfDay(currentTime, config.timezone);
  const scheduledTime = session && config.sessionTimes?.[session]
    ? config.sessionTimes[session]
    : config.time;
  const scheduledMinutes = parseScheduledMinutes(scheduledTime);
  const absoluteDifference = Math.abs(currentMinutes - scheduledMinutes);
  const circularDifference = Math.min(absoluteDifference, 1440 - absoluteDifference);

  return circularDifference <= DAILY_SIGNALS_SCHEDULE_WINDOW_MINUTES;
}

export function getDueDailySignalSessions(
  currentTime: Date,
  config: DailySignalsConfig,
): DailySignalSession[] {
  return TRADING_SESSIONS.filter(session => shouldRunNow(currentTime, config, session));
}

export async function getDailySignalsConfig(): Promise<DailySignalsConfig> {
  const defaultEnabled = normalizeBoolean(process.env.APEX_DAILY_SIGNALS_ENABLED, true);
  const legacyDefaultTime = normalizeTime(
    process.env.APEX_DAILY_SIGNALS_TIME,
    DEFAULT_DAILY_SIGNAL_SESSION_TIMES.london,
  );
  const defaultSessionTimes: DailySignalSessionTimes = {
    asia: normalizeTime(
      process.env.APEX_DAILY_SIGNALS_ASIA_TIME,
      DEFAULT_DAILY_SIGNAL_SESSION_TIMES.asia,
    ),
    london: normalizeTime(
      process.env.APEX_DAILY_SIGNALS_LONDON_TIME,
      legacyDefaultTime,
    ),
    new_york: normalizeTime(
      process.env.APEX_DAILY_SIGNALS_NEW_YORK_TIME,
      DEFAULT_DAILY_SIGNAL_SESSION_TIMES.new_york,
    ),
  };
  const defaultTimezone = process.env.APEX_DAILY_SIGNALS_TIMEZONE?.trim() || "UTC";
  const defaultMinimumGrade = normalizeGrade(process.env.APEX_DAILY_SIGNALS_MIN_GRADE, "B");
  const defaultTelegramEnabled = normalizeBoolean(process.env.APEX_DAILY_SIGNALS_TELEGRAM_ENABLED, true);
  const defaultSendZeroSignalSummary = normalizeBoolean(
    process.env.APEX_DAILY_SIGNALS_SEND_ZERO_SIGNAL_SUMMARY,
    true,
  );

  const sessionTimes: DailySignalSessionTimes = {
    asia: normalizeTime(
      await getSetting("daily_signals_asia_time", defaultSessionTimes.asia),
      defaultSessionTimes.asia,
    ),
    london: normalizeTime(
      await getSetting("daily_signals_london_time", defaultSessionTimes.london),
      defaultSessionTimes.london,
    ),
    new_york: normalizeTime(
      await getSetting("daily_signals_new_york_time", defaultSessionTimes.new_york),
      defaultSessionTimes.new_york,
    ),
  };

  return {
    enabled: normalizeBoolean(await getSetting("daily_signals_enabled", String(defaultEnabled)), defaultEnabled),
    timezone: (await getSetting("daily_signals_timezone", defaultTimezone)).trim() || defaultTimezone,
    minimumGrade: normalizeGrade(
      await getSetting("daily_signals_min_grade", defaultMinimumGrade),
      defaultMinimumGrade,
    ),
    telegramEnabled: normalizeBoolean(
      await getSetting("daily_signals_telegram_enabled", String(defaultTelegramEnabled)),
      defaultTelegramEnabled,
    ),
    sendZeroSignalSummary: normalizeBoolean(
      await getSetting("daily_signals_send_zero_signal_summary", String(defaultSendZeroSignalSummary)),
      defaultSendZeroSignalSummary,
    ),
    sessionTimes,
    time: sessionTimes.london,
  };
}
