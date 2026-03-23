import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { printValidationReport, validateRuntimeEnv } from "./validate-env.mjs";

const require = createRequire(import.meta.url);

const validationReport = validateRuntimeEnv({
  service: "web",
  strict: process.env.NODE_ENV === "production" || process.env.APEX_STRICT_STARTUP === "true",
});
printValidationReport(validationReport);
if (validationReport.errors.length > 0) {
  process.exit(1);
}

const port = process.env.PORT ?? "3000";
const host = process.env.HOST ?? "0.0.0.0";
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(
  process.execPath,
  [nextBin, "start", "--hostname", host, "--port", port],
  {
    stdio: "inherit",
    env: process.env,
  }
);

child.on("error", error => {
  console.error("[start-web] Failed to start Next.js:", error);
  process.exit(1);
});

child.on("exit", code => {
  process.exit(code ?? 0);
});
