import type { TraderSignalGrade } from "@/src/lib/traderContracts";
import { TRADER_SIGNAL_GRADES } from "@/src/lib/traderContracts";

const settingsCache = new Map<string, { value: string; cachedAt: number }>();
const SETTINGS_CACHE_TTL_MS = 60_000;

function hasDatabaseConfig(): boolean {
  const url = process.env.DATABASE_URL?.trim() || process.env.DIRECT_DATABASE_URL?.trim();
  return Boolean(url);
}

async function getPrismaClient() {
  if (!hasDatabaseConfig()) {
    return null;
  }

  const { prisma } = await import("@/lib/prisma");
  return prisma;
}

function readCachedSetting(key: string): string | null {
  const cached = settingsCache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.cachedAt >= SETTINGS_CACHE_TTL_MS) {
    settingsCache.delete(key);
    return null;
  }
  return cached.value;
}

function writeCachedSetting(key: string, value: string): void {
  settingsCache.set(key, {
    value,
    cachedAt: Date.now(),
  });
}

function normalizeTelegramGrade(value: string, fallback: TraderSignalGrade): TraderSignalGrade {
  return TRADER_SIGNAL_GRADES.includes(value as TraderSignalGrade)
    ? value as TraderSignalGrade
    : fallback;
}

export async function getSetting(key: string, defaultValue: string): Promise<string> {
  const cached = readCachedSetting(key);
  if (cached != null) {
    return cached;
  }

  const prisma = await getPrismaClient();
  if (!prisma) {
    writeCachedSetting(key, defaultValue);
    return defaultValue;
  }

  try {
    const record = await prisma.operatorSettings.findUnique({
      where: { key },
    });
    const value = record?.value ?? defaultValue;
    writeCachedSetting(key, value);
    return value;
  } catch (error) {
    console.error(`[operatorSettings] Failed to read setting "${key}":`, error);
    writeCachedSetting(key, defaultValue);
    return defaultValue;
  }
}

export async function getTelegramConfig(): Promise<{
  minGrade: TraderSignalGrade;
  includeBGrade: boolean;
}> {
  const defaultMinGrade = normalizeTelegramGrade(
    process.env.APEX_TELEGRAM_MIN_GRADE ?? process.env.TELEGRAM_MIN_GRADE ?? "B",
    "B",
  );
  const defaultIncludeBGrade = process.env.APEX_TELEGRAM_INCLUDE_B_SIGNALS ?? process.env.TELEGRAM_INCLUDE_B_SIGNALS ?? "true";

  const minGrade = normalizeTelegramGrade(
    await getSetting("telegram_min_grade", defaultMinGrade),
    defaultMinGrade,
  );
  const includeBGrade = (await getSetting("telegram_include_b_grade", defaultIncludeBGrade)).trim().toLowerCase() === "true";

  return {
    minGrade,
    includeBGrade,
  };
}

export async function setSetting(key: string, value: string): Promise<void> {
  settingsCache.delete(key);

  const prisma = await getPrismaClient();
  if (!prisma) {
    return;
  }

  try {
    await prisma.operatorSettings.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  } catch (error) {
    console.error(`[operatorSettings] Failed to write setting "${key}":`, error);
  }
}
