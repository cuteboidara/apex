import { getApexRuntime } from "@/src/application/cycle/buildRuntime";

// Canonical infrastructure entrypoint for the focused runtime repository.
export { ApexRepository } from "@/src/lib/repository";
export type {
  ExecutionHealth,
  RiskState,
} from "@/src/lib/repository";

export function getRepository() {
  return getApexRuntime().repository;
}
