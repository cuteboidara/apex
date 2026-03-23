import "dotenv/config";

import { printValidationReport, validateRuntimeEnv } from "./validate-env.mjs";

const services = ["web", "worker", "scheduler", "backfill"];
let hasErrors = false;

for (const service of services) {
  const report = validateRuntimeEnv({ service, strict: true });
  printValidationReport(report);
  if (report.errors.length > 0) {
    hasErrors = true;
  }
}

if (hasErrors) {
  process.exit(1);
}
