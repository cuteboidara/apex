import { prisma } from "@/lib/prisma";
import { getCachedValue, setCachedValue } from "@/lib/runtime/runtimeCache";
import type { CachedExplanationRecord, ExplanationStatus, LlmPurpose } from "@/lib/llm/types";

const GENERATED_TTL_MS = Number.parseInt(process.env.APEX_EXPLANATION_GENERATED_TTL_MS ?? "", 10) || 24 * 60 * 60_000;
const TEMPLATE_TTL_MS = Number.parseInt(process.env.APEX_EXPLANATION_TEMPLATE_TTL_MS ?? "", 10) || 12 * 60 * 60_000;
const UNAVAILABLE_TTL_MS = Number.parseInt(process.env.APEX_EXPLANATION_UNAVAILABLE_TTL_MS ?? "", 10) || 60 * 60_000;

function cacheKey(fingerprint: string, purpose: LlmPurpose) {
  return `llm:explanation:${purpose}:${fingerprint}`;
}

function ttlForStatus(status: ExplanationStatus) {
  if (status === "generated") return GENERATED_TTL_MS;
  if (status === "template") return TEMPLATE_TTL_MS;
  return UNAVAILABLE_TTL_MS;
}

function normalizeRecord(record: {
  fingerprint: string;
  purpose: string;
  status: string;
  provider: string;
  fallbackUsed: boolean;
  fallbackChain: unknown;
  content: string;
  errorMetadata: unknown;
  generatedAt: Date | string;
}): CachedExplanationRecord {
  return {
    fingerprint: record.fingerprint,
    purpose: record.purpose as LlmPurpose,
    status: record.status as ExplanationStatus,
    provider: record.provider as CachedExplanationRecord["provider"],
    fallbackUsed: record.fallbackUsed,
    fallbackChain: Array.isArray(record.fallbackChain) ? record.fallbackChain as CachedExplanationRecord["fallbackChain"] : [],
    content: record.content,
    errorMetadata: record.errorMetadata as CachedExplanationRecord["errorMetadata"],
    generatedAt: typeof record.generatedAt === "string" ? record.generatedAt : record.generatedAt.toISOString(),
  };
}

export async function getCachedExplanationRecord(fingerprint: string, purpose: LlmPurpose): Promise<CachedExplanationRecord | null> {
  const memoryOrRedis = await getCachedValue<CachedExplanationRecord>(cacheKey(fingerprint, purpose));
  if (memoryOrRedis) {
    return memoryOrRedis;
  }

  try {
    const dbRecord = await prisma.explanationCache.findUnique({
      where: {
        fingerprint_purpose: {
          fingerprint,
          purpose,
        },
      },
    });
    if (!dbRecord) {
      return null;
    }

    const normalized = normalizeRecord(dbRecord);
    await setCachedValue(cacheKey(fingerprint, purpose), normalized, ttlForStatus(normalized.status));
    return normalized;
  } catch {
    return null;
  }
}

export async function storeExplanationRecord(record: CachedExplanationRecord): Promise<void> {
  const ttlMs = ttlForStatus(record.status);
  await setCachedValue(cacheKey(record.fingerprint, record.purpose), record, ttlMs);

  try {
    await prisma.explanationCache.upsert({
      where: {
        fingerprint_purpose: {
          fingerprint: record.fingerprint,
          purpose: record.purpose,
        },
      },
      create: {
        fingerprint: record.fingerprint,
        purpose: record.purpose,
        status: record.status,
        provider: record.provider,
        fallbackUsed: record.fallbackUsed,
        fallbackChain: record.fallbackChain,
        content: record.content,
        errorMetadata: record.errorMetadata ?? undefined,
        generatedAt: new Date(record.generatedAt),
      },
      update: {
        status: record.status,
        provider: record.provider,
        fallbackUsed: record.fallbackUsed,
        fallbackChain: record.fallbackChain,
        content: record.content,
        errorMetadata: record.errorMetadata ?? undefined,
        generatedAt: new Date(record.generatedAt),
      },
    });
  } catch {
    // DB persistence is helpful but optional for explanation caching.
  }
}
