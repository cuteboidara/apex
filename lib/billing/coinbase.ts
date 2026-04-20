import { createHmac, timingSafeEqual } from "node:crypto";

export type CoinbaseChargeInput = {
  amountCents: number;
  name: string;
  description: string;
  metadata: Record<string, string>;
  redirectUrl?: string;
  cancelUrl?: string;
};

export type CoinbaseChargeResult = {
  chargeId: string;
  hostedUrl: string;
  expiresAt: string | null;
  addresses: Record<string, string>;
  pricing: Record<string, { amount: string; currency: string }>;
};

const COINBASE_API_URL = process.env.COINBASE_COMMERCE_API_URL?.trim() || "https://api.commerce.coinbase.com";
const COINBASE_API_VERSION = "2018-03-22";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value != null ? value as Record<string, unknown> : {};
}

export async function createCoinbaseCharge(input: CoinbaseChargeInput): Promise<CoinbaseChargeResult> {
  const apiKey = process.env.COINBASE_COMMERCE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Coinbase Commerce API key is not configured.");
  }

  const payload = {
    name: input.name,
    description: input.description,
    pricing_type: "fixed_price",
    local_price: {
      amount: (input.amountCents / 100).toFixed(2),
      currency: "USD",
    },
    metadata: input.metadata,
    redirect_url: input.redirectUrl,
    cancel_url: input.cancelUrl,
  };

  const response = await fetch(`${COINBASE_API_URL}/charges`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CC-Api-Key": apiKey,
      "X-CC-Version": COINBASE_API_VERSION,
    },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !body) {
    throw new Error("Failed to create crypto checkout session.");
  }

  const data = asRecord(body.data);
  const hostedUrl = typeof data.hosted_url === "string" ? data.hosted_url : "";
  const chargeId = typeof data.id === "string" ? data.id : "";

  if (!hostedUrl || !chargeId) {
    throw new Error("Crypto checkout provider returned an invalid response.");
  }

  return {
    chargeId,
    hostedUrl,
    expiresAt: typeof data.expires_at === "string" ? data.expires_at : null,
    addresses: asRecord(data.addresses) as Record<string, string>,
    pricing: asRecord(data.pricing) as Record<string, { amount: string; currency: string }>,
  };
}

export function verifyCoinbaseWebhookSignature(rawBody: string, incomingSignature: string | null): boolean {
  const sharedSecret = process.env.COINBASE_COMMERCE_WEBHOOK_SHARED_SECRET?.trim();
  if (!sharedSecret || !incomingSignature) {
    return false;
  }

  const expected = createHmac("sha256", sharedSecret).update(rawBody, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const incomingBuffer = Buffer.from(incomingSignature, "utf8");

  if (expectedBuffer.length !== incomingBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, incomingBuffer);
}

