type Severity = "DEBUG" | "INFO" | "WARN" | "ERROR";

type LogContext = {
  runId?: string;
  asset?: string;
  component: string;
  message: string;
  severity?: Severity;
  [key: string]: unknown;
};

export function logEvent({
  severity = "INFO",
  ...context
}: LogContext): void {
  const payload = {
    timestamp: new Date().toISOString(),
    severity,
    ...context,
  };

  const line = JSON.stringify(payload);

  if (severity === "ERROR") {
    console.error(line);
    return;
  }

  if (severity === "WARN") {
    console.warn(line);
    return;
  }

  console.log(line);
}
