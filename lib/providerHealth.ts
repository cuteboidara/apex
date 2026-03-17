import { prisma } from "@/lib/prisma";

type ProviderHealthInput = {
  provider: string;
  requestSymbol?: string | null;
  detail?: string | null;
  latencyMs?: number | null;
  errorRate?: number | null;
  quotaRemaining?: number | null;
  status: string;
};

export async function recordProviderHealth(input: ProviderHealthInput): Promise<void> {
  try {
    await prisma.providerHealth.create({
      data: {
        provider: input.provider,
        requestSymbol: input.requestSymbol ?? null,
        detail: input.detail ?? null,
        latencyMs: input.latencyMs ?? null,
        errorRate: input.errorRate ?? null,
        quotaRemaining: input.quotaRemaining ?? null,
        status: input.status,
      },
    });
  } catch {
    // Health recording must not break request paths.
  }
}
