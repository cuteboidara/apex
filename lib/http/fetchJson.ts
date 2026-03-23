export type ParsedJsonResponse<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  code: string | null;
  details: string | null;
  likelyMigrationIssue: boolean;
  hint: string | null;
};

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export async function readJsonResponse<T>(response: Response): Promise<ParsedJsonResponse<T>> {
  const text = await response.text().catch(() => "");

  if (!text.trim()) {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      error: response.ok ? null : `Request failed with status ${response.status}.`,
      code: null,
      details: null,
      likelyMigrationIssue: false,
      hint: null,
    };
  }

  try {
    const data = JSON.parse(text) as T;
    const record = data && typeof data === "object" ? data as Record<string, unknown> : null;

    return {
      ok: response.ok,
      status: response.status,
      data,
      error: readString(record?.error) ?? (response.ok ? null : `Request failed with status ${response.status}.`),
      code: readString(record?.code),
      details: readString(record?.details),
      likelyMigrationIssue: record?.likelyMigrationIssue === true,
      hint: readString(record?.hint),
    };
  } catch {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: response.ok
        ? "Server returned an unreadable JSON response."
        : `Request failed with status ${response.status} and a non-JSON response.`,
      code: "INVALID_JSON_RESPONSE",
      details: text.slice(0, 500),
      likelyMigrationIssue: false,
      hint: null,
    };
  }
}

export async function fetchJsonResponse<T>(input: RequestInfo | URL, init?: RequestInit): Promise<ParsedJsonResponse<T>> {
  try {
    const response = await fetch(input, init);
    return readJsonResponse<T>(response);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : String(error),
      code: "NETWORK_ERROR",
      details: null,
      likelyMigrationIssue: false,
      hint: null,
    };
  }
}

export function formatApiError(result: Pick<ParsedJsonResponse<unknown>, "error" | "details" | "likelyMigrationIssue" | "hint">, fallbackMessage: string) {
  const base = result.error ?? fallbackMessage;
  if (result.likelyMigrationIssue) {
    return result.hint ? `${base} ${result.hint}` : base;
  }
  if (result.details && result.error == null) {
    return `${base} ${result.details}`;
  }
  return base;
}
