import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // No free structured macro-calendar source is wired in this pass.
  // Keep the endpoint stable and non-failing while the platform runs on Yahoo/Binance/FRED/RSS only.
  return NextResponse.json([]);
}
