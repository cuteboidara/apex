import { timingSafeEqual } from "node:crypto";

function secretsMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export function extractApexSecretFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice("bearer ".length).trim();
    if (token) {
      return token;
    }
  }

  const headerSecret = request.headers.get("x-apex-secret")?.trim() ?? "";
  return headerSecret || null;
}

export function validateApexSecretRequest(
  request: Request,
  configuredSecret: string | undefined,
): { ok: true } | { ok: false; status: 401 | 500; error: string } {
  const secret = configuredSecret?.trim();
  if (!secret) {
    return {
      ok: false,
      status: 500,
      error: "APEX_SECRET not configured",
    };
  }

  const providedSecret = extractApexSecretFromRequest(request);
  if (!providedSecret || !secretsMatch(secret, providedSecret)) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized",
    };
  }

  return { ok: true };
}

export const validateApexSecret = validateApexSecretRequest;
