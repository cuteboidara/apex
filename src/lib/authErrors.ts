export const AUTH_SERVICE_UNAVAILABLE = "AUTH_SERVICE_UNAVAILABLE";

function decodeError(error: string): string {
  try {
    return decodeURIComponent(error);
  } catch {
    return error;
  }
}

export function resolveSignInErrorMessage(error: string | null | undefined): string {
  const decoded = error ? decodeError(error) : "";
  const normalized = decoded.toLowerCase();

  if (normalized.includes(AUTH_SERVICE_UNAVAILABLE.toLowerCase())) {
    return "Sign-in is temporarily unavailable because the operator database is offline.";
  }
  if (normalized.includes("pending approval")) {
    return "Your account is pending approval. You will be notified when approved.";
  }
  if (normalized.includes("suspended")) {
    return "Your account has been suspended. Contact support.";
  }
  if (normalized.includes("banned")) {
    return "Your account has been banned.";
  }

  return "Invalid email or password.";
}
