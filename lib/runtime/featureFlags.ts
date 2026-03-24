const FALSE_VALUES = new Set(["0", "false", "off", "no"]);

export function readBooleanEnvFlag(key: string, fallback: boolean) {
  const raw = process.env[key];
  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  return !FALSE_VALUES.has(raw.trim().toLowerCase());
}

export function readStringEnvFlag(key: string, fallback: string) {
  const raw = process.env[key];
  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  return raw.trim();
}

export function getCoreSignalRuntime() {
  const requestedMode = readStringEnvFlag("APEX_CORE_SIGNAL_MODE", "deterministic").toLowerCase();
  const coreSignalMode = requestedMode === "deterministic" ? "deterministic" : requestedMode;
  const deterministic = coreSignalMode === "deterministic";

  return {
    coreSignalMode,
    deterministic,
    llmDisabled: readBooleanEnvFlag("APEX_DISABLE_LLM", deterministic),
    llmOptional: readBooleanEnvFlag("APEX_LLM_OPTIONAL", true),
    newsDisabled: readBooleanEnvFlag("APEX_DISABLE_NEWS", deterministic),
  };
}
