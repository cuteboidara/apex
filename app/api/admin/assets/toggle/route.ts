import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import { ADMIN_EMAIL } from "@/lib/admin/auth";
import { auditLog } from "@/lib/admin/auditLog";
import { isKnownSymbol } from "@/src/config/marketScope";
import {
  ASSET_MODULE_IDS,
  enableAllAssets,
  readAssetActivationState,
  updateAssetModuleEnabled,
  updateForexSymbolEnabled,
  type AssetModuleId,
} from "@/src/config/assetActivation";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json(readAssetActivationState());
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json() as {
    action?: string;
    symbol?: string;
    module?: string;
    active?: boolean;
  };

  if (body.action === "enable_all") {
    await auditLog("assets_enable_all", ADMIN_EMAIL);
    return NextResponse.json({
      success: true,
      config: enableAllAssets(),
    });
  }

  if (body.module) {
    if (!ASSET_MODULE_IDS.includes(body.module as AssetModuleId)) {
      return NextResponse.json({ error: "module not supported" }, { status: 400 });
    }

    if (typeof body.active !== "boolean") {
      return NextResponse.json({ error: "active boolean required" }, { status: 400 });
    }

    await auditLog("asset_module_toggled", ADMIN_EMAIL, {
      module: body.module,
      active: body.active,
    });
    return NextResponse.json({
      success: true,
      module: body.module,
      active: body.active,
      config: updateAssetModuleEnabled(body.module as AssetModuleId, body.active),
    });
  }

  if (!body.symbol) {
    return NextResponse.json({ error: "symbol or module required" }, { status: 400 });
  }
  if (!isKnownSymbol(body.symbol)) {
    return NextResponse.json({ error: "symbol not supported by focused runtime" }, { status: 400 });
  }
  if (typeof body.active !== "boolean") {
    return NextResponse.json({ error: "active boolean required" }, { status: 400 });
  }

  await auditLog("asset_symbol_toggled", ADMIN_EMAIL, {
    symbol: body.symbol,
    active: body.active,
  });
  return NextResponse.json({
    success: true,
    symbol: body.symbol,
    active: body.active,
    config: updateForexSymbolEnabled(body.symbol, body.active),
  });
}
