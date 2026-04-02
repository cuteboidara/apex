import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/requireAdmin";
import { triggerCommoditiesCycle } from "@/src/assets/commodities/engine/commoditiesRuntime";
import { ALL_COMMODITY_SYMBOLS } from "@/src/assets/commodities/config/commoditiesScope";
import { triggerIndicesCycle } from "@/src/assets/indices/engine/indicesRuntime";
import { INDICES_SYMBOLS } from "@/src/assets/indices/config/indicesScope";
import { triggerMemeCycle } from "@/src/assets/memecoins/engine/memeRuntime";
import { triggerStocksCycle } from "@/src/assets/stocks/engine/stocksRuntime";
import { ALL_STOCK_SYMBOLS } from "@/src/assets/stocks/config/stocksScope";
import { getApexRuntime } from "@/src/application/cycle/buildRuntime";
import { queueFocusedRuntimeCycle } from "@/src/application/cycle/runCycle";
import { APEX_SYMBOLS } from "@/src/config/marketScope";
import { triggerCryptoCycle } from "@/src/crypto/engine/cryptoRuntime";
import { CRYPTO_ACTIVE_SYMBOLS } from "@/src/crypto/config/cryptoScope";
import { extractApexSecretFromRequest, validateApexSecretRequest } from "@/src/infrastructure/security/apexSecret";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CLASS_ROUTES = {
  forex: "/api/cycle",
  crypto: "/api/crypto-cycle-trigger",
  stocks: "/api/stocks-cycle-trigger",
  commodities: "/api/commodities-cycle-trigger",
  indices: "/api/indices-cycle-trigger",
  memecoins: "/api/meme-cycle-trigger",
} as const;

const ALL_CLASSES = Object.keys(CLASS_ROUTES) as AssetClass[];

const ASSET_CLASS_MAP: Record<string, AssetClass> = Object.fromEntries([
  ...APEX_SYMBOLS.map(symbol => [symbol, "forex"] as const),
  ...CRYPTO_ACTIVE_SYMBOLS.map(symbol => [symbol, "crypto"] as const),
  ...ALL_STOCK_SYMBOLS.map(symbol => [symbol, "stocks"] as const),
  ...ALL_COMMODITY_SYMBOLS.map(symbol => [symbol, "commodities"] as const),
  ...INDICES_SYMBOLS.map(symbol => [symbol, "indices"] as const),
]);

type AssetClass = keyof typeof CLASS_ROUTES;
type AuthMode = "secret" | "admin_session";
type SelectionApplied = "class" | "symbol_override" | "class_fallback";

type RunAssetsBody = {
  assets?: string[];
  classes?: string[];
  all?: boolean;
};

type RunSelection = {
  all: boolean;
  classes: AssetClass[];
  assets: string[];
  assetsByClass: Partial<Record<AssetClass, string[]>>;
};

type RunClassResult = {
  class: AssetClass;
  route: string;
  status: "queued" | "completed" | "failed";
  duration: number;
  error?: string;
  cycleId?: string | null;
  jobId?: string | null;
  cardCount?: number | null;
  universeSize?: number | null;
  selectionApplied: SelectionApplied;
  requestedAssets: string[];
};

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function normalizeClass(value: string): AssetClass | null {
  const normalized = value.trim().toLowerCase();
  return ALL_CLASSES.includes(normalized as AssetClass) ? normalized as AssetClass : null;
}

function buildSelection(body: RunAssetsBody): RunSelection {
  if (body.all) {
    return {
      all: true,
      classes: [...ALL_CLASSES],
      assets: [],
      assetsByClass: {},
    };
  }

  const requestedAssets = dedupeStrings(body.assets ?? []);
  const requestedClasses = dedupeStrings(body.classes ?? [])
    .map(normalizeClass)
    .filter((value): value is AssetClass => value != null);

  const derivedClasses = requestedAssets
    .map(asset => ASSET_CLASS_MAP[asset])
    .filter((value): value is AssetClass => value != null);

  const classes = dedupeStrings([...requestedClasses, ...derivedClasses]) as AssetClass[];
  const assetsByClass = requestedAssets.reduce<Partial<Record<AssetClass, string[]>>>((accumulator, asset) => {
    const assetClass = ASSET_CLASS_MAP[asset];
    if (!assetClass) {
      return accumulator;
    }
    accumulator[assetClass] ??= [];
    accumulator[assetClass]!.push(asset);
    return accumulator;
  }, {});

  return {
    all: false,
    classes,
    assets: requestedAssets,
    assetsByClass,
  };
}

async function authorizeRequest(request: NextRequest): Promise<
  | { ok: true; authMode: AuthMode }
  | { ok: false; response: NextResponse }
> {
  const providedSecret = extractApexSecretFromRequest(request);

  if (providedSecret) {
    const validation = validateApexSecretRequest(request, process.env.APEX_SECRET);
    if (!validation.ok) {
      return {
        ok: false,
        response: NextResponse.json({ error: validation.error }, { status: validation.status }),
      };
    }

    return { ok: true, authMode: "secret" };
  }

  const admin = await requireAdmin();
  if (!admin.ok) {
    return { ok: false, response: admin.response };
  }

  return { ok: true, authMode: "admin_session" };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

async function runForexCycle(requestedAssets: string[]): Promise<Omit<RunClassResult, "class" | "route">> {
  const startedAt = Date.now();
  const supportedAssets = requestedAssets.filter((asset): asset is (typeof APEX_SYMBOLS)[number] =>
    (APEX_SYMBOLS as readonly string[]).includes(asset),
  );
  const selectionApplied: SelectionApplied = requestedAssets.length === 0
    ? "class"
    : supportedAssets.length > 0
      ? "symbol_override"
      : "class_fallback";
  const runtime = getApexRuntime();
  const queued = await queueFocusedRuntimeCycle(
    runtime,
    "admin_run_control",
    supportedAssets.length > 0 ? { activeSymbolsOverride: supportedAssets } : undefined,
  );

  return {
    status: queued.queued ? "queued" : "completed",
    duration: Date.now() - startedAt,
    cycleId: queued.result?.cycle_id ?? null,
    jobId: queued.jobId ?? null,
    cardCount: queued.result?.symbols.length ?? null,
    selectionApplied,
    requestedAssets,
  };
}

async function executeClassRun(assetClass: AssetClass, requestedAssets: string[]): Promise<RunClassResult> {
  const route = CLASS_ROUTES[assetClass];
  const startedAt = Date.now();

  try {
    if (assetClass === "forex") {
      const result = await runForexCycle(requestedAssets);
      return {
        class: assetClass,
        route,
        ...result,
      };
    }

    if (assetClass === "crypto") {
      const result = await triggerCryptoCycle();
      return {
        class: assetClass,
        route,
        status: "completed",
        duration: Date.now() - startedAt,
        cycleId: result.cycleId,
        cardCount: result.cardCount,
        selectionApplied: requestedAssets.length > 0 ? "class_fallback" : "class",
        requestedAssets,
      };
    }

    if (assetClass === "stocks") {
      const result = await triggerStocksCycle();
      return {
        class: assetClass,
        route,
        status: "completed",
        duration: Date.now() - startedAt,
        cycleId: result.cycleId,
        cardCount: result.cardCount,
        selectionApplied: requestedAssets.length > 0 ? "class_fallback" : "class",
        requestedAssets,
      };
    }

    if (assetClass === "commodities") {
      const result = await triggerCommoditiesCycle();
      return {
        class: assetClass,
        route,
        status: "completed",
        duration: Date.now() - startedAt,
        cycleId: result.cycleId,
        cardCount: result.cardCount,
        selectionApplied: requestedAssets.length > 0 ? "class_fallback" : "class",
        requestedAssets,
      };
    }

    if (assetClass === "indices") {
      const result = await triggerIndicesCycle();
      return {
        class: assetClass,
        route,
        status: "completed",
        duration: Date.now() - startedAt,
        cycleId: result.cycleId,
        cardCount: result.cardCount,
        selectionApplied: requestedAssets.length > 0 ? "class_fallback" : "class",
        requestedAssets,
      };
    }

    const result = await triggerMemeCycle();
    return {
      class: assetClass,
      route,
      status: "completed",
      duration: Date.now() - startedAt,
      cycleId: result.cycleId,
      cardCount: result.cardCount,
      universeSize: result.universeSize,
      selectionApplied: "class",
      requestedAssets,
    };
  } catch (error) {
    return {
      class: assetClass,
      route,
      status: "failed",
      duration: Date.now() - startedAt,
      error: formatError(error),
      selectionApplied: requestedAssets.length > 0 && assetClass !== "forex" ? "class_fallback" : "class",
      requestedAssets,
    };
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeRequest(request);
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => ({})) as RunAssetsBody;
  const selection = buildSelection(body);

  if (selection.classes.length === 0) {
    return NextResponse.json(
      { error: "No asset classes or supported assets selected." },
      { status: 400 },
    );
  }

  const startedAt = Date.now();
  console.log("[APEX RUN CONTROL] Running:", selection, "| Started:", new Date(startedAt).toISOString());

  const settled = await Promise.allSettled(
    selection.classes.map(assetClass => executeClassRun(assetClass, selection.assetsByClass[assetClass] ?? [])),
  );

  const results = settled.map((result, index) => {
    const assetClass = selection.classes[index]!;
    if (result.status === "fulfilled") {
      return result.value;
    }

    return {
      class: assetClass,
      route: CLASS_ROUTES[assetClass],
      status: "failed",
      duration: Date.now() - startedAt,
      error: formatError(result.reason),
      selectionApplied: selection.assetsByClass[assetClass]?.length ? "class_fallback" : "class",
      requestedAssets: selection.assetsByClass[assetClass] ?? [],
    } satisfies RunClassResult;
  });

  const successCount = results.filter(result => result.status !== "failed").length;
  const failedCount = results.filter(result => result.status === "failed").length;

  return NextResponse.json({
    success: failedCount === 0,
    partial: successCount > 0 && failedCount > 0,
    authMode: auth.authMode,
    headerName: "x-apex-secret",
    selection: {
      all: selection.all,
      classes: selection.classes,
      assets: selection.assets,
    },
    startedAt,
    completedAt: Date.now(),
    results,
  });
}
