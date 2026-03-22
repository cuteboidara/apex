import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/requireAdmin";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

const CONFIG_PATH = path.join(process.cwd(), "lib/config/activeAssets.json");

function readConfig(): Record<string, boolean> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json(readConfig());
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const { symbol, active } = await req.json() as { symbol: string; active: boolean };
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  const config = readConfig();
  config[symbol] = active;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  return NextResponse.json({ success: true, symbol, active });
}
