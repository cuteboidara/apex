import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));

export function resolveFromProjectRoot(...segments: string[]) {
  return path.join(PROJECT_ROOT, ...segments);
}
