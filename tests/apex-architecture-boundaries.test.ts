import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");

function walk(dir: string, extensions = new Set([".ts", ".tsx"])): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath, extensions));
      continue;
    }

    if (extensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

function relative(filePath: string): string {
  return path.relative(projectRoot, filePath).replaceAll("\\", "/");
}

function read(relativePath: string): string {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("src/domain/ files do not import from src/infrastructure/", () => {
  const domainFiles = walk(path.join(projectRoot, "src/domain"));
  const offenders = domainFiles.filter(file => /from\s+["']@\/src\/infrastructure\//.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders.map(relative), []);
});

test("src/domain/ files do not import from lib/ beyond approved pure utility types", () => {
  const allowed = new Set(["@/src/lib/ids", "@/src/lib/traderContracts"]);
  const domainFiles = walk(path.join(projectRoot, "src/domain"));
  const offenders: string[] = [];

  for (const file of domainFiles) {
    const content = readFileSync(file, "utf8");
    const imports = [...content.matchAll(/from\s+["'](@\/src\/lib\/[^"']+)["']/g)].map(match => match[1]);
    if (imports.some(importPath => !allowed.has(importPath))) {
      offenders.push(relative(file));
    }
  }

  assert.deepEqual(offenders, []);
});

test("SignalViewModel is only constructed by SignalViewModelBuilder in src/", () => {
  const allowedFiles = new Set([
    "src/domain/services/viewModelBuilder.ts",
    "src/domain/models/signalPipeline.ts",
    "src/application/signals/canonicalReadService.ts",
  ]);
  const offenders: string[] = [];

  for (const file of walk(path.join(projectRoot, "src"))) {
    const rel = relative(file);
    if (allowedFiles.has(rel)) {
      continue;
    }

    const content = readFileSync(file, "utf8");
    if (/SignalViewModel\s*=\s*\{/.test(content) || /as\s+SignalViewModel/.test(content)) {
      offenders.push(rel);
    }
  }

  assert.deepEqual(offenders, []);
});

test("canonicalSignalsCompatibility has zero active callers", () => {
  const legacyFile = path.join(projectRoot, "src/domain/services/canonicalSignalsCompatibility.ts");
  assert.equal(existsSync(legacyFile), false);

  const matches = walk(path.join(projectRoot, "src"))
    .concat(walk(path.join(projectRoot, "app")))
    .filter(file => readFileSync(file, "utf8").includes("canonicalSignalsCompatibility"));
  assert.deepEqual(matches.map(relative), []);
});

test("TraderSignalCard has zero active callers", () => {
  const matches = walk(path.join(projectRoot, "src"))
    .concat(walk(path.join(projectRoot, "app")))
    .filter(file => readFileSync(file, "utf8").includes("TraderSignalCard"));
  assert.deepEqual(matches.map(relative), []);
});

test("in-memory fallback paths do not exist in repository", () => {
  const repository = read("src/lib/repository.ts");

  assert.match(repository, /export class RepositoryUnavailableError extends Error/);
  assert.match(repository, /throw new RepositoryUnavailableError\("prisma import"/);
  assert.match(repository, /throw new RepositoryUnavailableError\("systemEvent\.findMany"/);
  assert.doesNotMatch(repository, /const merged = new Map<string, TraderPairRuntimeState>\(\);[\s\S]*getLiveTraderPairRuntimeStates/);
});

test("all active pods emit PodVote and the live path uses the identity adapter only", () => {
  const podAdapters = read("src/domain/pods/podAdapters.ts");
  const runCycle = read("src/application/cycle/runCycle.ts");
  const mappers = read("src/domain/services/signalPipelineMappers.ts");

  assert.match(podAdapters, /export function identityAdapter/);
  assert.doesNotMatch(podAdapters, /adaptPodOutput|adaptPodOutputs/);
  assert.match(runCycle, /identityAdapter/);
  assert.match(mappers, /identityAdapter/);
  assert.doesNotMatch(runCycle, /adaptPodOutput|adaptPodOutputs/);
  assert.doesNotMatch(mappers, /adaptPodOutput|adaptPodOutputs/);
});

test("Phase 5 seams point to canonical application and infrastructure implementations", () => {
  const cycle = read("src/application/cycle/runCycle.ts");
  const engine = read("src/lib/engine.ts");
  const runtime = read("src/lib/runtime.ts");
  const prisma = read("lib/prisma.ts");
  const auth = read("lib/auth.ts");

  assert.match(cycle, /export async function executeApexCycle/);
  assert.match(cycle, /persistCanonicalCycleOutput/);
  assert.match(engine, /executeApexCycle/);
  assert.match(runtime, /buildRuntime as getRuntime/);
  assert.match(prisma, /src\/infrastructure\/db\/prisma/);
  assert.match(auth, /src\/infrastructure\/auth\/auth/);
});
