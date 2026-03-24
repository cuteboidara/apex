import "dotenv/config";

const RAW_REDIS_KEYS = ["REDIS_URL", "KV_URL", "UPSTASH_REDIS_URL", "UPSTASH_REDIS_TLS_URL"];
const REST_REDIS_KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL"];

const requirementSets = {
  shared: {
    required: [
      ["DATABASE_URL", "Primary database connection used by Prisma and runtime services"],
    ],
    warnings: [
      ["DIRECT_DATABASE_URL", "Optional direct database connection mirror is not configured"],
      ["APEX_CORE_SIGNAL_MODE", "Core signal mode defaults to deterministic; set it explicitly for go-live clarity"],
      ["APEX_DISABLE_LLM", "LLM calls default to disabled in deterministic mode; set it explicitly for go-live clarity"],
      ["APEX_DISABLE_NEWS", "News enrichment defaults to disabled in deterministic mode; set it explicitly for go-live clarity"],
      ["APEX_LLM_OPTIONAL", "LLM providers are treated as optional by default; set it explicitly for go-live clarity"],
      ["TELEGRAM_BOT_TOKEN", "Telegram alert delivery will be unavailable"],
      ["RESEND_API_KEY", "Signup/admin email notifications will be unavailable"],
    ],
  },
  web: {
    required: [
      ["NEXTAUTH_SECRET", "Authentication signing secret"],
    ],
    warnings: [
      ["NEXTAUTH_URL", "Canonical app URL should be configured"],
      ["FRED_API_KEY", "Macro data will be unavailable"],
    ],
  },
  worker: {
    required: [
      [RAW_REDIS_KEYS.join("|"), "BullMQ requires a raw Redis URL"],
    ],
    warnings: [
      ["FRED_API_KEY", "Macro data will be unavailable"],
    ],
  },
  scheduler: {
    required: [
      [RAW_REDIS_KEYS.join("|"), "BullMQ requires a raw Redis URL"],
    ],
    warnings: [],
  },
  backfill: {
    required: [],
    warnings: [
      ["FRED_API_KEY", "Macro data will be unavailable"],
    ],
  },
};

function isConfigured(token) {
  return token
    .split("|")
    .some(key => {
      const value = process.env[key];
      return Boolean(value && value !== "PASTE_YOUR_KEY_HERE");
    });
}

function hasOnlyRestRedis() {
  const hasRaw = RAW_REDIS_KEYS.some(key => isConfigured(key));
  const hasRest = REST_REDIS_KEYS.some(key => isConfigured(key));
  return !hasRaw && hasRest;
}

export function validateRuntimeEnv(input = {}) {
  const service = input.service ?? "web";
  const strict = input.strict ?? (process.env.NODE_ENV === "production");
  const definition = requirementSets[service] ?? requirementSets.web;
  const shared = requirementSets.shared;

  const errors = [];
  const warnings = [];

  for (const [key, description] of [...shared.required, ...definition.required]) {
    if (!isConfigured(key)) {
      errors.push(`Missing ${key}: ${description}`);
    }
  }

  for (const [key, description] of [...shared.warnings, ...definition.warnings]) {
    if (!isConfigured(key)) {
      warnings.push(`Missing ${key}: ${description}`);
    }
  }

  if (service === "web") {
    const nextAuthSecret = process.env.NEXTAUTH_SECRET ?? "";
    if (nextAuthSecret && nextAuthSecret !== "replace_me" && nextAuthSecret.length < 32) {
      const message = "NEXTAUTH_SECRET should be at least 32 characters for production safety.";
      if (strict) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }

    if (strict && !isConfigured("NEXTAUTH_URL")) {
      errors.push("Missing NEXTAUTH_URL: production web startup requires a canonical app URL.");
    }
  }

  if ((service === "worker" || service === "scheduler") && hasOnlyRestRedis()) {
    errors.push("Only Upstash REST Redis credentials were found. BullMQ requires REDIS_URL, KV_URL, UPSTASH_REDIS_URL, or UPSTASH_REDIS_TLS_URL.");
  }

  return {
    service,
    strict,
    errors,
    warnings,
  };
}

export function printValidationReport(report) {
  if (report.errors.length === 0 && report.warnings.length === 0) {
    console.log(`Environment validation passed for ${report.service}.`);
    return;
  }

  for (const warning of report.warnings) {
    console.warn(warning);
  }

  for (const error of report.errors) {
    console.error(error);
  }

  if (report.errors.length === 0) {
    console.log(`Environment validation completed with ${report.warnings.length} warning(s) for ${report.service}.`);
  }
}

function runCli() {
  const service = process.argv.find(arg => arg.startsWith("--service="))?.split("=")[1] ?? "web";
  const strict = process.argv.includes("--strict") || process.env.NODE_ENV === "production";
  const report = validateRuntimeEnv({ service, strict });
  printValidationReport(report);

  if (report.errors.length > 0) {
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("validate-env.mjs")) {
  runCli();
}
