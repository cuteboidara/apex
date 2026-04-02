import "./load-env.mjs";

import { printValidationReport, validateRuntimeEnv } from "./validate-env.mjs";

const services = ["web", "worker", "backfill"];
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
