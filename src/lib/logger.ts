type LogLevel = "debug" | "info" | "warn" | "error";

export type LogPayload = {
  module: string;
  message: string;
  summary?: string;
  [key: string]: unknown;
};

function emit(level: LogLevel, payload: LogPayload) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...payload,
  });

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  debug(payload: LogPayload) {
    emit("debug", payload);
  },
  info(payload: LogPayload) {
    emit("info", payload);
  },
  warn(payload: LogPayload) {
    emit("warn", payload);
  },
  error(payload: LogPayload) {
    emit("error", payload);
  },
};
