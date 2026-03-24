export type ProviderAvailability = "available" | "blocked" | "degraded" | "offline";
export type ProviderBlockedReason = "credits" | "rate_limit" | "permissions" | "configuration" | null;

export function classifyProviderStatus(
  status: string,
  detail: string | null | undefined,
  provider?: string | null
): {
  availability: ProviderAvailability;
  blockedReason: ProviderBlockedReason;
  displayStatus: "available" | "degraded" | "offline";
} {
  const normalizedStatus = status.toLowerCase();
  const normalizedDetail = String(detail ?? "").toLowerCase();
  const normalizedProvider = String(provider ?? "").toLowerCase();

  if (
    normalizedProvider === "binance" &&
    (
      normalizedDetail.includes("451") ||
      normalizedDetail.includes("region") ||
      normalizedDetail.includes("restricted location") ||
      normalizedDetail.includes("unavailable from a restricted location")
    )
  ) {
    return { availability: "degraded", blockedReason: null, displayStatus: "degraded" };
  }

  const blockedReason: ProviderBlockedReason =
    normalizedDetail.includes("credit balance is too low") ||
    normalizedDetail.includes("run out of api credits") ||
    normalizedDetail.includes("exceeded your current quota") ||
    normalizedDetail.includes("insufficient_quota") ||
    normalizedDetail.includes("quota exceeded") ||
    normalizedDetail.includes("daily limit") ||
    normalizedDetail.includes("resource exhausted")
      ? "credits"
      : normalizedDetail.includes("rate limit") ||
          normalizedDetail.includes("rate_limit_exceeded") ||
          normalizedDetail.includes("too many requests") ||
          normalizedDetail.includes("spreading out your free api requests") ||
          normalizedDetail.includes("concurrent connections has exceeded") ||
          normalizedDetail.includes("http_429")
        ? "rate_limit"
        : normalizedDetail.includes("403") ||
            normalizedDetail.includes("401") ||
            normalizedDetail.includes("api key not valid") ||
            normalizedDetail.includes("unauthorized") ||
            normalizedDetail.includes("forbidden") ||
            normalizedDetail.includes("premium endpoint") ||
            normalizedDetail.includes("subscription") ||
            normalizedDetail.includes("not entitled")
          ? "permissions"
          : normalizedDetail.includes("missing_api_key") ||
              normalizedDetail.includes("not configured")
            ? "configuration"
            : null;

  if (normalizedStatus === "missing") {
    return { availability: "offline", blockedReason: null, displayStatus: "offline" };
  }

  if (normalizedProvider === "yahoo finance" && blockedReason) {
    return { availability: "degraded", blockedReason: null, displayStatus: "degraded" };
  }

  if (blockedReason) {
    return { availability: "blocked", blockedReason, displayStatus: "offline" };
  }

  if (["configured", "online", "healthy", "live", "ok"].includes(normalizedStatus)) {
    return { availability: "available", blockedReason: null, displayStatus: "available" };
  }

  if (["degraded"].includes(normalizedStatus)) {
    return { availability: "degraded", blockedReason: null, displayStatus: "degraded" };
  }

  if (["offline", "error", "unavailable", "unhealthy"].includes(normalizedStatus)) {
    return { availability: "offline", blockedReason: null, displayStatus: "offline" };
  }

  return { availability: "available", blockedReason: null, displayStatus: "available" };
}
