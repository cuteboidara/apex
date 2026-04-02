import fs from "node:fs";

import { resolveFromProjectRoot } from "@/lib/projectRoot";
import { APEX_SYMBOLS, type ApexSymbol } from "@/src/config/marketScope";

export const ASSET_MODULE_IDS = ["forex", "crypto", "stocks", "commodities", "indices", "memecoins"] as const;
export type AssetModuleId = typeof ASSET_MODULE_IDS[number];

export type AssetActivationState = {
  modules: Record<AssetModuleId, boolean>;
  forexSymbols: Record<ApexSymbol, boolean>;
};

const CONFIG_PATH = resolveFromProjectRoot("lib", "config", "activeAssets.json");

function buildDefaultModules(): Record<AssetModuleId, boolean> {
  return Object.fromEntries(
    ASSET_MODULE_IDS.map(moduleId => [moduleId, true]),
  ) as Record<AssetModuleId, boolean>;
}

function buildDefaultForexSymbols(): Record<ApexSymbol, boolean> {
  return Object.fromEntries(
    APEX_SYMBOLS.map(symbol => [symbol, true]),
  ) as Record<ApexSymbol, boolean>;
}

export function createDefaultAssetActivationState(): AssetActivationState {
  return {
    modules: buildDefaultModules(),
    forexSymbols: buildDefaultForexSymbols(),
  };
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAssetActivationState(raw: unknown): AssetActivationState {
  const defaults = createDefaultAssetActivationState();
  const normalized: AssetActivationState = {
    modules: { ...defaults.modules },
    forexSymbols: { ...defaults.forexSymbols },
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return normalized;
  }

  const record = raw as Record<string, unknown>;
  const rawModules = isBooleanRecord(record.modules) ? record.modules : {};
  const rawForexSymbols = isBooleanRecord(record.forexSymbols) ? record.forexSymbols : {};

  for (const moduleId of ASSET_MODULE_IDS) {
    if (typeof rawModules[moduleId] === "boolean") {
      normalized.modules[moduleId] = rawModules[moduleId];
      continue;
    }

    if (typeof record[moduleId] === "boolean") {
      normalized.modules[moduleId] = record[moduleId] as boolean;
    }
  }

  for (const symbol of APEX_SYMBOLS) {
    if (typeof rawForexSymbols[symbol] === "boolean") {
      normalized.forexSymbols[symbol] = rawForexSymbols[symbol];
      continue;
    }

    if (typeof record[symbol] === "boolean") {
      normalized.forexSymbols[symbol] = record[symbol] as boolean;
    }
  }

  return normalized;
}

export function readAssetActivationState(): AssetActivationState {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as unknown;
    return normalizeAssetActivationState(raw);
  } catch {
    return createDefaultAssetActivationState();
  }
}

export function writeAssetActivationState(state: AssetActivationState): AssetActivationState {
  const normalized = normalizeAssetActivationState(state);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2));
  return normalized;
}

export function enableAllAssets(): AssetActivationState {
  return writeAssetActivationState(createDefaultAssetActivationState());
}

export function isAssetModuleEnabled(moduleId: AssetModuleId, state = readAssetActivationState()): boolean {
  return state.modules[moduleId] !== false;
}

export function isForexSymbolEnabled(symbol: ApexSymbol, state = readAssetActivationState()): boolean {
  return isAssetModuleEnabled("forex", state) && state.forexSymbols[symbol] !== false;
}

export function getEnabledForexSymbols(
  symbols: readonly ApexSymbol[],
  state = readAssetActivationState(),
): ApexSymbol[] {
  if (!isAssetModuleEnabled("forex", state)) {
    return [];
  }

  return symbols.filter(symbol => isForexSymbolEnabled(symbol, state));
}

export function updateAssetModuleEnabled(moduleId: AssetModuleId, active: boolean): AssetActivationState {
  const next = readAssetActivationState();
  next.modules[moduleId] = active;
  return writeAssetActivationState(next);
}

export function updateForexSymbolEnabled(symbol: ApexSymbol, active: boolean): AssetActivationState {
  const next = readAssetActivationState();
  next.forexSymbols[symbol] = active;
  return writeAssetActivationState(next);
}
