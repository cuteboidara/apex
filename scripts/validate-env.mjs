import "./load-env.mjs";

const RAW_REDIS_KEYS = ["REDIS_URL", "KV_URL", "UPSTASH_REDIS_URL", "UPSTASH_REDIS_TLS_URL"];
const REST_REDIS_KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL"];

const requirementSets = {
  shared: {
    required: [
      ["DATABASE_URL", "Primary database connection used by Prisma and runtime services"],
    ],
    warnings: [
      ["ANTHROPIC_API_KEY", "Claude reasoning and market commentary will fall back to deterministic copy"],
      ["APEX_DISABLE_LLM", "Claude reasoning defaults to the runtime fallback; set APEX_DISABLE_LLM explicitly for go-live clarity"],
      ["POLYGON_API_KEY", "Stocks, commodities, and indices remain disabled without Polygon.io credentials"],
      ["COINGECKO_API_KEY", "CoinGecko discovery will run on the free tier and may be rate limited"],
      ["APEX_DAILY_SIGNALS_SECRET|APEX_SECRET", "Manual daily signal route auth falls back to APEX_SECRET unless a dedicated secret is configured"],
      [RAW_REDIS_KEYS.join("|"), "BullMQ-backed queue workers remain unavailable without a raw Redis URL"],
    ],
  },
  web: {
    required: [
      ["NEXTAUTH_SECRET", "Authentication signing secret"],
      ["NEXTAUTH_URL", "Canonical app URL"],
      ["APEX_SECRET", "Master secret for runtime cycle control"],
      ["TELEGRAM_BOT_TOKEN", "Telegram delivery token"],
      ["TELEGRAM_CHAT_ID", "Telegram delivery target chat/channel"],
    ],
    warnings: [
      ["TWELVE_DATA_API_KEY", "Twelve Data live FX pricing is optional; dashboard live-price rows may be null without it"],
      ["OANDA_API_TOKEN", "Oanda is the primary FX candle source; without it the runtime falls back to Yahoo Finance"],
      ["OANDA_ENV", "Oanda environment should be set to practice or live for explicit FX provider targeting"],
      ["APEX_REQUIRE_LIVE_DATA", "Set APEX_REQUIRE_LIVE_DATA explicitly for deterministic FX fallback behavior"],
    ],
  },
  worker: {
    required: [
      [RAW_REDIS_KEYS.join("|"), "BullMQ requires a raw Redis URL"],
    ],
    warnings: [
      ["APEX_DAILY_SIGNALS_SECRET|APEX_SECRET", "Worker-driven daily signal invocations need a validated secret"],
    ],
  },
  backfill: {
    required: [],
    warnings: [],
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

  if (service === "worker" && hasOnlyRestRedis()) {
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
