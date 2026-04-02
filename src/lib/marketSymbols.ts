const CANONICAL_MARKET_SYMBOL_ALIASES: Record<string, readonly string[]> = {
  XAUUSD: ["XAUUSD", "GC=F", "GOLD", "XAU/USD"],
  XAGUSD: ["XAGUSD", "SI=F", "SILVER", "XAG/USD"],
};

const ALIAS_TO_CANONICAL = Object.entries(CANONICAL_MARKET_SYMBOL_ALIASES).reduce<Record<string, string>>(
  (lookup, [canonical, aliases]) => {
    for (const alias of aliases) {
      lookup[alias.toUpperCase()] = canonical;
    }
    return lookup;
  },
  {},
);

export const YAHOO_DIRECT_METAL_SYMBOL_MAP: Record<string, string> = {
  XAUUSD: "GC=F",
  XAGUSD: "SI=F",
};

export function canonicalizeMarketSymbol(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return ALIAS_TO_CANONICAL[trimmed.toUpperCase()] ?? trimmed.toUpperCase();
}

export function expandMarketSymbolAliases(symbols: readonly string[]): string[] {
  const expanded = new Set<string>();

  for (const symbol of symbols) {
    const canonical = canonicalizeMarketSymbol(symbol);
    if (!canonical) {
      continue;
    }

    expanded.add(canonical);
    for (const alias of CANONICAL_MARKET_SYMBOL_ALIASES[canonical] ?? [canonical]) {
      expanded.add(alias);
    }
  }

  return [...expanded];
}
